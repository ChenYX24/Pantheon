package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

const homeResourceTestSecret = "stage-b-private-value-never-return"

type homeResourceTestAPI struct {
	t      *testing.T
	s      *Server
	values []string
}

type homeResourceTransport func(*http.Request) (*http.Response, error)

func (f homeResourceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newHomeResourceTestAPI(t *testing.T) homeResourceTestAPI {
	t.Helper()
	s := newInProcessTestServer(t)
	homeFixture(t, s)
	s.Cfg.Development = true
	s.Cfg.GPUBoardSnapshot = filepath.Join(s.Cfg.DataDir, "board.json")
	s.homeResources.sshConfig = filepath.Join(s.Cfg.DataDir, ".ssh/config")
	s.homeResources.checkHTTP = &http.Client{Transport: homeResourceTransport(func(*http.Request) (*http.Response, error) {
		t.Error("unexpected outbound request")
		return nil, errors.New("network disabled")
	})}
	return homeResourceTestAPI{t, s, []string{homeResourceTestSecret}}
}

func (a homeResourceTestAPI) request(method, path, body string, code int) *httptest.ResponseRecorder {
	a.t.Helper()
	w := homeRequest(a.t, a.s, method, path, body, true)
	var value any
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
			a.t.Fatal(err)
		}
	}
	var scan func(any)
	scan = func(v any) {
		switch v := v.(type) {
		case string:
			for _, secret := range a.values {
				if strings.Contains(v, secret) {
					a.t.Fatal("response disclosed a stored secret")
				}
			}
		case map[string]any:
			for key, item := range v {
				scan(key)
				scan(item)
			}
		case []any:
			for _, item := range v {
				scan(item)
			}
		}
	}
	scan(value)
	if w.Code != code {
		a.t.Fatalf("%s %s: HTTP %d want %d: %s", method, path, w.Code, code, w.Body.String())
	}
	return w
}

func (a homeResourceTestAPI) create(body string) homeResource {
	a.t.Helper()
	return homeDecode[homeResource](a.t, a.request("POST", "/api/home/resources", body, 201), 201)
}

func (a homeResourceTestAPI) secret(id, name, value string) {
	a.t.Helper()
	body, _ := json.Marshal(map[string]string{"value": value})
	a.request("PUT", "/api/home/resources/"+id+"/secrets/"+name, string(body), 200)
}

func TestHomeResourceAPIRevisionsSecretsOrphansAndDelete(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	r := a.create(`{"id":"api","kind":"api","title":"Main","env":["API_KEY","UNSET_TOKEN"],"body":"Usage docs"}`)
	if len(r.Secrets) != 2 || r.Secrets[0].Configured || r.LastCheck != nil || r.Server != nil {
		t.Fatalf("%+v", r)
	}
	a.create(`{"id":"other","kind":"other","title":"Other","projects":["elsewhere"]}`)
	a.request("POST", "/api/home/resources", `{"id":"api","kind":"api","title":"Duplicate"}`, 409)
	a.secret("api", "API_KEY", homeResourceTestSecret)
	a.secret("api", "EXTRA_TOKEN", homeResourceTestSecret)
	a.request("PUT", "/api/home/resources/api/secrets/API_KEY", `{"value":""}`, 400)
	a.request("PUT", "/api/home/resources/api/secrets/lower", `{"value":"x"}`, 400)
	a.request("PUT", "/api/home/resources/missing/secrets/KEY", `{"value":"x"}`, 404)
	a.request("PUT", "/api/home/resources/api/secrets/API_KEY", `{"value":"`+strings.Repeat("x", 8193)+`"}`, 400)
	a.request("PUT", "/api/home/resources/api/secrets/API_KEY", `{"value":"bad\u0000value"}`, 400)
	got := homeDecode[homeResource](t, a.request("GET", "/api/home/resources/api", "", 200), 200)
	if len(got.Secrets) != 3 || !got.Secrets[0].Configured || got.Secrets[0].UpdatedAt == "" || got.Secrets[2].Configured {
		t.Fatalf("%+v", got.Secrets)
	}
	patch := `{"rev":"` + r.Rev + `","title":"Edited","body":"Changed docs"}`
	r = homeDecode[homeResource](t, a.request("PATCH", "/api/home/resources/api", patch, 200), 200)
	a.request("PATCH", "/api/home/resources/api", patch, 409)
	a.request("DELETE", "/api/home/resources/api?rev=stale", "", 409)
	project := homeDecode[struct {
		Resources        []homeResource
		DefaultResources []string
	}](t, a.request("GET", "/api/home/projects/demo/resources", "", 200), 200)
	if len(project.Resources) != 1 || project.DefaultResources == nil {
		t.Fatalf("%+v", project)
	}
	a.request("PATCH", "/api/home/projects/demo/meta", `{"rev":"","resources":["api"]}`, 200)
	project = homeDecode[struct {
		Resources        []homeResource
		DefaultResources []string
	}](t, a.request("GET", "/api/home/projects/demo/resources", "", 200), 200)
	if !reflect.DeepEqual(project.DefaultResources, []string{"api"}) {
		t.Fatal(project)
	}
	file := filepath.Join(a.s.Cfg.DataDir, "harness", r.File)
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	list := homeDecode[homeResourceList](t, a.request("GET", "/api/home/resources", "", 200), 200)
	if len(list.Orphans) != 1 || list.Orphans[0].ResourceID != "api" || len(list.Orphans[0].Names) != 2 {
		t.Fatal(list.Orphans)
	}
	a.request("DELETE", "/api/home/resources/api/secrets/API_KEY", "", 204)
	a.request("DELETE", "/api/home/resources/api/secrets/EXTRA_TOKEN", "", 204)
	r = a.create(`{"id":"api","kind":"api","title":"Replacement"}`)
	a.secret("api", "KEY", homeResourceTestSecret)
	if err := a.s.DB.AddResourceCheck(context.Background(), "api", resourceCheck(true, "ok", map[string]int{"status": 200})); err != nil {
		t.Fatal(err)
	}
	a.request("DELETE", "/api/home/resources/api?rev="+r.Rev, "", 204)
	list = homeDecode[homeResourceList](t, a.request("GET", "/api/home/resources", "", 200), 200)
	checks, err := a.s.DB.ResourceChecks(context.Background(), "api")
	if err != nil || len(checks) != 0 || len(list.Orphans) != 0 {
		t.Fatal("resource data survived deletion", err)
	}
	a.request("GET", "/api/home/resources/api", "", 404)
}

func TestHomeResourceProviderChecksAndRedaction(t *testing.T) {
	for _, variant := range []struct{ provider, name, header, value, path string }{
		{"anthropic", "ANTHROPIC_API_KEY", "x-api-key", homeResourceTestSecret, "/v1/models"},
		{"anthropic", "ANTHROPIC_AUTH_TOKEN", "Authorization", "Bearer " + homeResourceTestSecret, "/v1/models"},
		{"openai", "OPENAI_API_KEY", "Authorization", "Bearer " + homeResourceTestSecret, "/models"},
		{"openai-compatible", "PROXY_TOKEN", "Authorization", "Bearer " + homeResourceTestSecret, "/models"},
	} {
		t.Run(variant.provider+variant.name, func(t *testing.T) {
			a := newHomeResourceTestAPI(t)
			calls, fail := 0, false
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != variant.path || r.Method != "GET" || r.Header.Get(variant.header) != variant.value {
					t.Error("wrong provider request shape")
				}
				if variant.provider == "anthropic" && r.Header.Get("anthropic-version") != "2023-06-01" {
					t.Error("missing anthropic version")
				}
				if fail {
					w.WriteHeader(401)
					fmt.Fprint(w, strings.Repeat("x", 185)+homeResourceTestSecret+strings.Repeat("tail", 100))
					return
				}
				models := []map[string]string{{"id": homeResourceTestSecret}}
				for n := 1; n < 60; n++ {
					models = append(models, map[string]string{"id": fmt.Sprintf("model-%d", n)})
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"data": models})
			}))
			defer remote.Close()
			a.s.homeResources.checkHTTP = remote.Client()
			body, _ := json.Marshal(map[string]any{"id": "provider", "kind": "api", "title": "Provider", "provider": variant.provider, "baseUrl": remote.URL, "env": []string{"MISSING_KEY", variant.name}, "check": "provider"})
			a.create(string(body))
			a.secret("provider", variant.name, homeResourceTestSecret)
			a.request("GET", "/api/home/resources", "", 200)
			if calls != 0 {
				t.Fatal("listing ran a provider check")
			}
			check := homeDecode[store.ResourceCheck](t, a.request("POST", "/api/home/resources/provider/check", `{}`, 200), 200)
			var detail struct {
				Status, ModelCount int
				Models             []string
				Balance            string
			}
			if err := json.Unmarshal(check.Detail, &detail); err != nil {
				t.Fatal(err)
			}
			if !check.OK || detail.Status != 200 || detail.ModelCount != 60 || len(detail.Models) != 50 || detail.Balance != "unknown" {
				t.Fatalf("%+v %+v", check, detail)
			}
			fail = true
			check = homeDecode[store.ResourceCheck](t, a.request("POST", "/api/home/resources/provider/check", `{}`, 200), 200)
			if check.OK || len([]rune(strings.TrimPrefix(check.Summary, "HTTP 401: "))) > 200 || !strings.Contains(check.Summary, "[redacted]") {
				t.Fatal(check.Summary)
			}
			a.request("GET", "/api/home/resources/provider", "", 200)
			a.request("GET", "/api/home/resources", "", 200)
			uses, _ := a.s.DB.ResourceUses(context.Background(), "provider")
			if len(uses) != 2 || uses[0].Purpose != "check" {
				t.Fatal(uses)
			}
		})
	}
}

func TestHomeResourceHTTPCheckAndRedirects(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	hits := 0
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
			t.Error("HTTP check carried a secret")
		}
		w.Header().Set("Location", "/must-not-follow")
		w.WriteHeader(302)
	}))
	defer remote.Close()
	a.s.homeResources.checkHTTP = remote.Client()
	body, _ := json.Marshal(map[string]any{"id": "site", "kind": "service", "title": "Site", "url": remote.URL, "check": "http"})
	a.create(string(body))
	a.secret("site", "KEY", homeResourceTestSecret)
	check := homeDecode[store.ResourceCheck](t, a.request("POST", "/api/home/resources/site/check", `{}`, 200), 200)
	if !check.OK || hits != 1 {
		t.Fatalf("%+v hits %d", check, hits)
	}
	a.create(`{"id":"none","kind":"other","title":"None"}`)
	a.request("POST", "/api/home/resources/none/check", `{}`, 400)
	provider, _ := json.Marshal(map[string]any{"id": "provider", "kind": "api", "title": "P", "provider": "openai", "baseUrl": remote.URL, "env": []string{"KEY"}, "check": "provider"})
	a.create(string(provider))
	a.secret("provider", "KEY", homeResourceTestSecret)
	// This fake deliberately returns a redirect, without following it or
	// contacting the Location. Its request should carry the provider key.
	a.s.homeResources.checkHTTP = &http.Client{Transport: homeResourceTransport(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer "+homeResourceTestSecret {
			t.Error("provider key missing")
		}
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://never-contact.invalid"}}, Body: http.NoBody, Request: r}, nil
	})}
	check = homeDecode[store.ResourceCheck](t, a.request("POST", "/api/home/resources/provider/check", `{}`, 200), 200)
	if check.OK {
		t.Fatal("provider accepted redirect")
	}
}

func TestHomeResourceSSHCheckAndImportUseOnlyFake(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	homePut(t, a.s.homeResources.sshConfig, "Host gpu-a gpu-b wild* !excluded\n  HostName private-address\nInclude extra/*.conf\n")
	homePut(t, filepath.Join(filepath.Dir(a.s.homeResources.sshConfig), "extra/nodes.conf"), "Host included\nUser private-user\n")
	bin := filepath.Join(a.s.Cfg.DataDir, "bin")
	homePut(t, filepath.Join(bin, "ssh"), "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME_SSH_TEST_ARGS\"\nprintf 'fake diagnostic' >&2\nexit 0\n")
	if err := os.Chmod(filepath.Join(bin, "ssh"), 0755); err != nil {
		t.Fatal(err)
	}
	argsFile := filepath.Join(a.s.Cfg.DataDir, "ssh-args")
	t.Setenv("PATH", bin)
	t.Setenv("HOME_SSH_TEST_ARGS", argsFile)
	servers := homeDecode[home.Servers](t, a.request("GET", "/api/home/servers", "", 200), 200)
	if servers.Board.Available || !reflect.DeepEqual(servers.SSHAliases, []string{"gpu-a", "gpu-b", "included"}) {
		t.Fatalf("%+v", servers)
	}
	result := homeDecode[struct{ Created, Skipped []string }](t, a.request("POST", "/api/home/resources/import/ssh", `{"aliases":["gpu-a","included"]}`, 200), 200)
	if len(result.Created) != 2 {
		t.Fatal(result)
	}
	result = homeDecode[struct{ Created, Skipped []string }](t, a.request("POST", "/api/home/resources/import/ssh", `{"aliases":["gpu-a"]}`, 200), 200)
	if len(result.Created) != 0 || !reflect.DeepEqual(result.Skipped, []string{"gpu-a"}) {
		t.Fatal(result)
	}
	a.request("POST", "/api/home/resources/import/ssh", `{"aliases":["gpu-b","unknown"]}`, 400)
	a.request("GET", "/api/home/resources/gpu-b", "", 404)
	if _, err := os.Stat(argsFile); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("listing/import invoked ssh")
	}
	check := homeDecode[store.ResourceCheck](t, a.request("POST", "/api/home/resources/gpu-a/check", `{}`, 200), 200)
	args, _ := os.ReadFile(argsFile)
	if !check.OK || string(args) != "-o\nBatchMode=yes\n-o\nConnectTimeout=8\n-o\nConnectionAttempts=1\ngpu-a\ntrue\n" {
		t.Fatalf("%+v args %q", check, args)
	}
	a.create(`{"id":"bad-ssh","kind":"server","title":"Bad","sshAlias":"-oProxyCommand=bad","check":"ssh"}`)
	a.request("POST", "/api/home/resources/bad-ssh/check", `{}`, 400)
	a.request("GET", "/api/home/resources/gpu-a", "", 200)
}

func TestHomeResourceProfileImportAndPrompt(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	_, err := a.s.DB.CreateLaunchProfile(context.Background(), "profile", store.LaunchProfile{Name: "Claude Main", Command: []string{"claude"}, Env: []store.LaunchEnvVar{
		{Name: "ANTHROPIC_API_KEY", Value: homeResourceTestSecret, Secret: true}, {Name: "EMPTY_TOKEN", Secret: true}, {Name: "ANTHROPIC_BASE_URL", Value: "https://provider.invalid"}, {Name: "REGION", Value: "local"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	r := homeDecode[homeResource](t, a.request("POST", "/api/home/resources/import/profile", `{"profileId":"profile"}`, 201), 201)
	if r.ID != "claude-main" || r.Provider != "anthropic" || r.BaseURL != "https://provider.invalid" || !reflect.DeepEqual(r.Env, []string{"ANTHROPIC_API_KEY"}) || len(r.Secrets) != 1 || !r.Secrets[0].Configured {
		t.Fatalf("%+v", r)
	}
	r = homeDecode[homeResource](t, a.request("PATCH", "/api/home/resources/claude-main", `{"rev":"`+r.Rev+`","body":"Existing usage","projects":["demo"]}`, 200), 200)
	r = homeDecode[homeResource](t, a.request("POST", "/api/home/resources/import/profile", `{"profileId":"profile","resourceId":"claude-main"}`, 200), 200)
	if r.Body != "Existing usage" || !reflect.DeepEqual(r.Projects, []string{"demo"}) {
		t.Fatal("import overwrote docs or scope")
	}
	a.create(`{"id":"private","kind":"other","title":"Forbidden title","projects":["other"]}`)
	prompt := a.s.homeResourcePrompt("demo")
	for _, want := range []string{"可用资源", "claude-main", "ANTHROPIC_API_KEY", "Existing usage"} {
		if !strings.Contains(prompt, want) {
			t.Fatal("prompt missing", want)
		}
	}
	if strings.Contains(prompt, homeResourceTestSecret) || strings.Contains(prompt, "Forbidden title") {
		t.Fatal("prompt disclosed secret or disallowed resource")
	}
	uses, _ := a.s.DB.ResourceUses(context.Background(), r.ID)
	if len(uses) != 0 {
		t.Fatal("prompt read secrets")
	}
	reply := parseHomeReply(`{"reply":"Use a resource","suggestions":[{"type":"use_resources","resources":["claude-main"]},{"type":"use_resources","resources":["../bad"]}]}`)
	if len(reply.Suggestions) != 1 || reply.Suggestions[0].Resources[0] != "claude-main" {
		t.Fatalf("%+v", reply)
	}
	a.request("GET", "/api/home/resources/claude-main", "", 200)
}

func TestHomeResourceSessionEnvironmentReceiptsAndScope(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	a.s.Cfg.DevelopmentTerminal = true
	a.create(`{"id":"allowed","kind":"api","title":"Allowed","env":["API_KEY"],"projects":["demo"]}`)
	a.create(`{"id":"forbidden","kind":"api","title":"Forbidden","projects":["other"]}`)
	a.secret("allowed", "API_KEY", homeResourceTestSecret)
	a.secret("allowed", "EXTRA_TOKEN", homeResourceTestSecret)
	a.request("POST", "/api/home/projects/demo/sessions", `{"resources":["allowed","forbidden"]}`, 403)
	uses, _ := a.s.DB.ResourceUses(context.Background(), "allowed")
	if len(uses) != 0 {
		t.Fatal("scope rejection read secrets")
	}
	a.request("PATCH", "/api/home/projects/demo/meta", `{"rev":"","resources":["allowed"]}`, 200)
	argsFile := filepath.Join(a.s.Cfg.DataDir, "tmux-args")
	bin := filepath.Join(a.s.Cfg.DataDir, "fake-tmux")
	homePut(t, bin, "#!/bin/sh\nshift 6\ncase \"$1\" in\n new-session) printf '%s\\n' \"$@\" > \"$HOME_TMUX_TEST_ARGS\"; if [ \"$HOME_TMUX_TEST_FAIL\" = yes ]; then printf '%s' \"$@\" >&2; exit 1; fi;;\n has-session) printf 'session not found' >&2; exit 1;;\nesac\nexit 0\n")
	if err := os.Chmod(bin, 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME_TMUX_TEST_ARGS", argsFile)
	t.Setenv("HOME_TMUX_TEST_FAIL", "")
	a.s.Tmux = tmux.New("home-resource-fake", a.s.Cfg.DataDir)
	a.s.Tmux.Bin = bin
	a.s.Tmux.ExternallyManaged = true
	a.s.Manager = session.NewManager(a.s.Tmux, 1024)
	t.Cleanup(a.s.Manager.DetachAll)
	created := homeDecode[map[string]string](t, a.request("POST", "/api/home/projects/demo/sessions", `{"name":"Resource session"}`, 201), 201)
	args, _ := os.ReadFile(argsFile)
	for _, want := range []string{"API_KEY=" + homeResourceTestSecret, "EXTRA_TOKEN=" + homeResourceTestSecret, "PANTHEON_RESOURCES=allowed"} {
		if !strings.Contains(string(args), "-e\n"+want+"\n") {
			t.Fatal("missing injected environment")
		}
	}
	uses, _ = a.s.DB.ResourceUses(context.Background(), "allowed")
	if len(uses) != 1 || uses[0].SessionID != created["sessionId"] || uses[0].ProjectID != "demo" || uses[0].Purpose != "session" {
		t.Fatalf("%+v", uses)
	}
	a.request("GET", "/api/home/resources/allowed", "", 200)
	t.Setenv("HOME_TMUX_TEST_FAIL", "yes")
	a.request("POST", "/api/home/projects/demo/sessions", `{"resources":["allowed"]}`, 500)
	uses, _ = a.s.DB.ResourceUses(context.Background(), "allowed")
	if len(uses) != 2 {
		t.Fatal("failed launch lost its receipt")
	}
	t.Setenv("HOME_TMUX_TEST_FAIL", "")
	a.request("POST", "/api/home/projects/demo/sessions", `{"resources":[]}`, 201)
	args, _ = os.ReadFile(argsFile)
	if strings.Contains(string(args), homeResourceTestSecret) || !strings.Contains(string(args), "PANTHEON_RESOURCES=\n") {
		t.Fatal("empty selection inherited default secrets")
	}
}

func TestHomeResourceRoutesAuthenticationAndExactAllowList(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	routes := map[string][]string{
		"/api/home/resources": {"GET", "POST"}, "/api/home/resources/item": {"GET", "PATCH", "DELETE"},
		"/api/home/resources/item/secrets/KEY": {"PUT", "DELETE"}, "/api/home/resources/item/check": {"POST"},
		"/api/home/resources/import/ssh": {"POST"}, "/api/home/resources/import/profile": {"POST"},
		"/api/home/servers": {"GET"}, "/api/home/projects/demo/resources": {"GET"},
	}
	for path, allowed := range routes {
		for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
			want := false
			for _, candidate := range allowed {
				want = want || method == candidate
			}
			if homePlanningRoute(method, path) != want {
				t.Fatalf("allow-list: %s %s", method, path)
			}
			if want {
				if w := homeRequest(t, a.s, method, path, `{}`, false); w.Code != 401 {
					t.Fatalf("unauthenticated %s %s: %d", method, path, w.Code)
				}
			}
		}
	}
	for _, path := range []string{"/api/home/resources/item/execute", "/api/home/resources/item/secrets/KEY/extra", "/api/resources/item", "/api/home/servers/extra"} {
		if homePlanningRoute("POST", path) {
			t.Fatal("widened route", path)
		}
	}
}

func TestHomeResourceCheckCancellationIsRecorded(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	a.create(`{"id":"api","kind":"api","title":"API","provider":"openai","baseUrl":"https://never-contact.invalid","env":["KEY"],"check":"provider"}`)
	a.secret("api", "KEY", homeResourceTestSecret)
	a.s.homeResources.checkHTTP = &http.Client{Transport: homeResourceTransport(func(r *http.Request) (*http.Response, error) {
		deadline, ok := r.Context().Deadline()
		if !ok || time.Until(deadline) > 20*time.Second {
			t.Error("missing check deadline")
		}
		return nil, errors.New(homeResourceTestSecret)
	})}
	check := homeDecode[store.ResourceCheck](t, a.request("POST", "/api/home/resources/api/check", `{}`, 200), 200)
	if check.OK {
		t.Fatal("transport failure succeeded")
	}
	a.request("GET", "/api/home/resources/api", "", 200)
}

func TestHomeResourceErrorRedactsQuotedAndOverlappingKeysBeforeClipping(t *testing.T) {
	values := map[string]string{"short": "prefix", "long": "prefix-secret-suffix", "quoted": "key\"with\nquotes"}
	text := `{"error":"prefix-secret-suffix and key\"with\nquotes"}`
	got := redactResourceText(text, values)
	for _, fragment := range []string{"prefix", "secret-suffix", "key", "quotes"} {
		if strings.Contains(got, fragment) {
			t.Fatal("error retained a secret fragment")
		}
	}
	if got != `{"error":"[redacted] and [redacted]"}` {
		t.Fatal(got)
	}
}

func TestHomeResourceServerSnapshotImportAndPrompt(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	a.values = append(a.values, "private-address", "private-identity", "private-uuid", "private-user", "private-stderr")
	homePut(t, a.s.homeResources.sshConfig, "Host cluster\nHostName private-address\n")
	writeSnapshot := func(at time.Time) {
		raw, _ := json.Marshal(map[string]any{"collected_at": at.Format(time.RFC3339Nano), "nodes": []any{
			map[string]any{"id": "board-node", "alias": "cluster", "group": "atombit", "label": "Board label", "state": "fresh", "reachability": "connected", "telemetry": "ok", "last_metrics_at": at.Format(time.RFC3339Nano), "last_success_at": at.Format(time.RFC3339Nano), "identity": "private-identity", "address": "private-address", "user": "private-user", "stderr": "private-stderr", "gpus": []any{map[string]any{"index": 0, "name": "Test GPU", "memory_total_mib": 24000, "memory_used_mib": 10, "utilization_pct": 0, "mig_mode": "disabled", "observation": "low_usage", "uuid": "private-uuid"}}},
		}})
		homePut(t, a.s.Cfg.GPUBoardSnapshot, string(raw))
	}
	writeSnapshot(time.Now().UTC())
	a.request("POST", "/api/home/resources/import/ssh", `{"aliases":["cluster"]}`, 200)
	r := homeDecode[homeResource](t, a.request("GET", "/api/home/resources/cluster", "", 200), 200)
	if r.Title != "Board label" || r.GPUBoardID != "board-node" || r.Server == nil || r.Server.ResourceID == nil || *r.Server.ResourceID != "cluster" || r.Server.State != "fresh" {
		t.Fatalf("%+v", r)
	}
	a.request("GET", "/api/home/servers", "", 200)
	body, _ := json.Marshal(map[string]any{"rev": r.Rev, "body": strings.Repeat("x", 1024) + "OUTSIDE_BODY_CAP"})
	a.request("PATCH", "/api/home/resources/cluster", string(body), 200)
	prompt := a.s.homeResourcePrompt("demo")
	if !strings.Contains(prompt, "Test GPU") || strings.Contains(prompt, "OUTSIDE_BODY_CAP") || strings.Contains(prompt, "private-") {
		t.Fatal("bad prompt projection")
	}
	writeSnapshot(time.Now().UTC().Add(-4 * time.Minute))
	prompt = a.s.homeResourcePrompt("demo")
	if strings.Contains(prompt, "Test GPU") || !strings.Contains(prompt, `"state":"stale"`) {
		t.Fatal("stale GPUs included in prompt")
	}
}

func TestHomeResourceDeletedDuringCheckDoesNotRegainHistory(t *testing.T) {
	a := newHomeResourceTestAPI(t)
	r := a.create(`{"id":"site","kind":"service","title":"Site","url":"https://never-contact.invalid","check":"http"}`)
	started, release := make(chan struct{}), make(chan struct{})
	a.s.homeResources.checkHTTP = &http.Client{Transport: homeResourceTransport(func(req *http.Request) (*http.Response, error) {
		close(started)
		select {
		case <-release:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: http.NoBody, Request: req}, nil
	})}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- homeRequest(t, a.s, "POST", "/api/home/resources/site/check", `{}`, true) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("check did not start")
	}
	a.request("DELETE", "/api/home/resources/site?rev="+r.Rev, "", 204)
	close(release)
	select {
	case response := <-done:
		if response.Code != 404 || strings.Contains(response.Body.String(), homeResourceTestSecret) {
			t.Fatal("deleted resource check was saved")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("check did not finish")
	}
	checks, err := a.s.DB.ResourceChecks(context.Background(), "site")
	if err != nil || len(checks) != 0 {
		t.Fatal("deleted checks resurrected", err)
	}
}
