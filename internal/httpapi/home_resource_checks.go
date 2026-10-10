package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func (s *Server) handleHomeResourceCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	at := time.Now().UTC()
	var resource home.Resource
	var values map[string]string
	if !func() bool {
		s.homeResources.mu.Lock()
		defer s.homeResources.mu.Unlock()
		var err error
		resource, err = s.Home.Resource(s.Cfg.CyxHome, chi.URLParam(r, "id"))
		if err != nil {
			homeError(w, err)
			return false
		}
		if resource.Check == "none" {
			writeErr(w, 400, "this resource has no check configured")
			return false
		}
		if resource.Check == "ssh" && !containsHomeAlias(s.homeSSHAliases(), resource.SSHAlias) {
			writeErr(w, 400, "ssh alias must be a concrete Host in the SSH config")
			return false
		}
		if resource.Check == "provider" {
			values, err = s.useHomeResource(ctx, resource.ID, "check", "", "")
		} else {
			err = s.DB.AddResourceUse(ctx, resource.ID, "check", "", "", at)
		}
		if err != nil {
			writeErr(w, 500, "resource check could not be prepared")
			return false
		}
		return true
	}() {
		return
	}
	var check store.ResourceCheck
	switch resource.Check {
	case "provider":
		check = s.checkHomeProvider(ctx, resource, values)
	case "ssh":
		check = checkHomeSSH(ctx, resource.SSHAlias)
	default:
		check = s.checkHomeHTTP(ctx, resource.URL)
	}
	check.At = at.Format(time.RFC3339Nano)
	// The network must not hold the resource write lock for twenty seconds.
	// Revalidate before saving so deletion cannot be undone by a late result.
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	current, err := s.Home.Resource(s.Cfg.CyxHome, resource.ID)
	if err != nil {
		homeError(w, err)
		return
	}
	if current.Rev != resource.Rev {
		writeErr(w, 409, "resource changed while checking")
		return
	}
	// A cancelled or timed-out network operation is still a check worth showing.
	save, cancelSave := context.WithTimeout(context.WithoutCancel(r.Context()), time.Second)
	defer cancelSave()
	if err := s.DB.AddResourceCheck(save, resource.ID, check); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, check)
}

func resourceCheck(ok bool, summary string, detail any) store.ResourceCheck {
	raw, _ := json.Marshal(detail)
	return store.ResourceCheck{OK: ok, Summary: summary, Detail: raw}
}

func (s *Server) homeCheckClient() *http.Client {
	client := http.Client{Timeout: 20 * time.Second}
	if s.homeResources.checkHTTP != nil {
		client = *s.homeResources.checkHTTP
	}
	// A redirect must not carry an API key to another host. HTTP checks report
	// the original 3xx as success without making a second request.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}

func homeCheckRequest(ctx context.Context, address string) (*http.Request, error) {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("check needs an HTTP(S) URL without credentials")
	}
	return http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
}

func redactResourceText(text string, values map[string]string) string {
	secrets := []string{}
	for _, value := range values {
		if value != "" {
			secrets = append(secrets, value)
			// Providers often quote a rejected key inside a JSON error string.
			quoted, _ := json.Marshal(value)
			secrets = append(secrets, string(quoted[1:len(quoted)-1]), url.QueryEscape(value), url.PathEscape(value))
		}
	}
	// A shorter key can be a prefix of another. Replacing it first would expose
	// the longer key's suffix, and map iteration would make that intermittent.
	sort.Slice(secrets, func(i, j int) bool { return len(secrets[i]) > len(secrets[j]) })
	pairs := []string{}
	for _, value := range secrets {
		pairs = append(pairs, value, "[redacted]")
	}
	return strings.NewReplacer(pairs...).Replace(text)
}

func firstResourceChars(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func (s *Server) checkHomeProvider(ctx context.Context, resource home.Resource, values map[string]string) store.ResourceCheck {
	detail := map[string]any{"status": 0, "models": []string{}, "modelCount": 0, "balance": "unknown"}
	address := strings.TrimRight(resource.BaseURL, "/")
	header, key := "Authorization", ""
	switch resource.Provider {
	case "anthropic":
		if address == "" {
			address = "https://api.anthropic.com"
		}
		address += "/v1/models"
		if value := values["ANTHROPIC_API_KEY"]; value != "" {
			header, key = "x-api-key", value
		} else if value := values["ANTHROPIC_AUTH_TOKEN"]; value != "" {
			key = "Bearer " + value
		}
	case "openai", "openai-compatible":
		address += "/models"
		for _, name := range resource.Env {
			if values[name] != "" {
				key = "Bearer " + values[name]
				break
			}
		}
	default:
		return resourceCheck(false, "provider checks are unsupported for this provider", detail)
	}
	if key == "" {
		return resourceCheck(false, "provider secret is not configured", detail)
	}
	req, err := homeCheckRequest(ctx, address)
	if err != nil {
		return resourceCheck(false, "provider base URL is invalid", detail)
	}
	req.Header.Set(header, key)
	if resource.Provider == "anthropic" {
		req.Header.Set("anthropic-version", "2023-06-01")
	}
	response, err := s.homeCheckClient().Do(req)
	if err != nil {
		// Transport errors contain the request URL and sometimes header values.
		return resourceCheck(false, "provider request failed or timed out", detail)
	}
	defer response.Body.Close()
	detail["status"] = response.StatusCode
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return resourceCheck(response.StatusCode == 200, "provider response could not be read within the limit", detail)
	}
	if response.StatusCode != 200 {
		// Redact before clipping, otherwise a key at the boundary leaks a prefix.
		message := firstResourceChars(redactResourceText(string(raw), values), 200)
		return resourceCheck(false, fmt.Sprintf("HTTP %d: %s", response.StatusCode, message), detail)
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return resourceCheck(true, "HTTP 200; model list unavailable", detail)
	}
	models := []string{}
	for _, model := range body.Data {
		if len(models) < 50 {
			models = append(models, firstResourceChars(redactResourceText(model.ID, values), 200))
		}
	}
	detail["models"], detail["modelCount"] = models, len(body.Data)
	return resourceCheck(true, fmt.Sprintf("HTTP 200; %d models; balance unknown", len(body.Data)), detail)
}

func (s *Server) checkHomeHTTP(ctx context.Context, address string) store.ResourceCheck {
	start := time.Now()
	req, err := homeCheckRequest(ctx, address)
	if err != nil {
		return resourceCheck(false, "HTTP URL is invalid", map[string]any{"status": 0, "ms": 0})
	}
	response, err := s.homeCheckClient().Do(req)
	if err != nil {
		return resourceCheck(false, "HTTP request failed or timed out", map[string]any{"status": 0, "ms": time.Since(start).Milliseconds()})
	}
	defer response.Body.Close()
	return resourceCheck(response.StatusCode >= 200 && response.StatusCode < 400, fmt.Sprintf("HTTP %d", response.StatusCode), map[string]any{"status": response.StatusCode, "ms": time.Since(start).Milliseconds()})
}

type homeCheckOutput struct{ data []byte }

func (b *homeCheckOutput) Write(data []byte) (int, error) {
	n := len(data)
	if remaining := 1024 - len(b.data); remaining > 0 {
		if len(data) > remaining {
			data = data[:remaining]
		}
		b.data = append(b.data, data...)
	}
	return n, nil
}

func checkHomeSSH(ctx context.Context, alias string) store.ResourceCheck {
	start := time.Now()
	cmd := exec.CommandContext(ctx, "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ConnectionAttempts=1", alias, "true")
	cmd.WaitDelay = 100 * time.Millisecond
	var stderr homeCheckOutput
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		code = -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		}
	}
	summary := "SSH connected"
	if err != nil {
		summary = "SSH connection failed or timed out"
	}
	return resourceCheck(err == nil, summary, map[string]any{"exitCode": code, "ms": time.Since(start).Milliseconds(), "stderr": firstResourceChars(string(stderr.data), 200)})
}
