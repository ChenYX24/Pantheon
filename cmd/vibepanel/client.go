package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jiangmuran/vibepanel/internal/auth"
	"github.com/jiangmuran/vibepanel/internal/config"
	"github.com/jiangmuran/vibepanel/internal/id"
	"github.com/jiangmuran/vibepanel/internal/store"
)

// The CLI as a client of the running panel (docs/cli.md).
//
// A command that changes what the panel shows -- a rename, a restart, text
// typed into a session -- goes through the panel's own API, so it is the
// same handler the browser uses: audited, the state pushed to every open
// tab, tmux asked by the process that owns it. Writing the database from a
// second process is what the first CLI did, and a plugin disabled that way
// kept running until a restart (build-log, "a change from the shell").
//
// The credential is an API token named "cli", minted once into the panel's
// own table by the CLI itself -- it runs as the panel's user, with the
// database in reach, so this is a default and not a boundary -- and kept
// in <data dir>/cli.token, 0600. A revoked token is minted again; the row
// is visible on the settings page like any other token, and can be revoked
// there to lock the shell out until the next run mints a new one.
//
// VIBEPANEL_CLI_URL and VIBEPANEL_CLI_TOKEN override both, for a panel
// reached across a wire. Without a reachable panel, the commands that have
// an offline implementation (the ones the first CLI had) fall back to it
// and say so; the rest say the panel is not running.

const (
	cliTokenFile = "cli.token"
	// panelURLFile is written by `serve` with the loopback URL of the panel
	// that owns the data directory, and removed when it stops.
	panelURLFile = "panel.url"
)

var (
	errPanelDown = errors.New("the panel is not running")
	// errNoAccount is a running panel with no account yet: nothing can be
	// minted, so a command with an offline path takes it, as before setup
	// the first CLI always did.
	errNoAccount = errors.New("the panel has no account yet")
)

func panelURLPath(dataDir string) string { return filepath.Join(dataDir, panelURLFile) }

type panelClient struct {
	cfg   config.Config
	base  string
	token string
	http  *http.Client
	// minted is true once this run minted a token, so a 401 after that is
	// not retried into a loop.
	minted bool
}

// openClient resolves the panel's address and the CLI's token, if there is
// one yet.
func openClient(ctx context.Context, args []string) (*panelClient, error) {
	cfg, err := config.Load(args, io.Discard)
	if err != nil {
		return nil, err
	}
	base := strings.TrimRight(os.Getenv("VIBEPANEL_CLI_URL"), "/")
	if base == "" {
		// The address the panel wrote, not the one the configuration would
		// compute: the configuration says where a panel *would* listen, and
		// on a machine with two of them that is somebody else's.
		if raw, rerr := os.ReadFile(panelURLPath(cfg.DataDir)); rerr == nil { //nolint:gosec // our own file
			base = strings.TrimRight(strings.TrimSpace(string(raw)), "/")
		}
	}
	c := &panelClient{cfg: cfg, base: base, http: &http.Client{Timeout: 30 * time.Second}}
	if base != "" {
		u, err := url.Parse(base)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("the panel's address %q is not an http(s) URL", base)
		}
		c.http.Transport = mcpTransport(u.Hostname())
	}
	c.token = strings.TrimSpace(os.Getenv("VIBEPANEL_CLI_TOKEN"))
	if c.token == "" {
		raw, rerr := os.ReadFile(c.tokenPath()) //nolint:gosec // our own 0600 file
		if rerr == nil {
			c.token = strings.TrimSpace(string(raw))
		}
	}
	// No token yet is not an error here: the first request finds out whether
	// the panel is even running, and only a 401 from a running panel mints
	// one. A command with an offline path on a machine with no account --
	// `session new` before setup -- must not be told to finish setup first.
	return c, nil
}

func (c *panelClient) tokenPath() string { return filepath.Join(c.cfg.DataDir, cliTokenFile) }

// mint writes an API token row and the file. The prefix is the first eight
// characters, as the settings page's own mint does.
func (c *panelClient) mint(ctx context.Context) error {
	db, err := store.Open(ctx, c.cfg.DBPath())
	if err != nil {
		return fmt.Errorf("the CLI needs the panel's database to mint its token: %w", err)
	}
	defer db.Close()
	owner, err := db.FirstUserID(ctx)
	if err != nil {
		return errNoAccount
	}
	token, err := auth.NewToken()
	if err != nil {
		return err
	}
	if _, err := db.CreateAPIToken(ctx, id.New(), auth.HashToken(token), token[:8], "cli", owner); err != nil {
		return err
	}
	_ = db.Audit(ctx, store.AuditEntry{At: time.Now().Unix(), Event: "token.created", Username: "cli", Detail: "cli (minted by the command line)"})
	if err := os.MkdirAll(c.cfg.DataDir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(c.tokenPath(), []byte(token+"\n"), 0o600); err != nil {
		return err
	}
	c.token, c.minted = token, true
	return nil
}

// apiError is a non-2xx answer: the status and the panel's own message.
type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return http.StatusText(e.Status)
}

// do is one request. A connection refused is errPanelDown; a 401 with a
// token from the file mints a new one and retries once.
func (c *panelClient) do(ctx context.Context, method, path string, body any, out any) error {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	if c.base == "" {
		return fmt.Errorf("%w: no %s under %s (and VIBEPANEL_CLI_URL is not set)", errPanelDown, panelURLFile, c.cfg.DataDir)
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := c.http.Do(req)
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) || strings.Contains(err.Error(), "connection refused") {
				return fmt.Errorf("%w at %s: %s", errPanelDown, c.base, trimDial(err))
			}
			return err
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
		res.Body.Close()
		if res.StatusCode == http.StatusUnauthorized && attempt == 0 && !c.minted && os.Getenv("VIBEPANEL_CLI_TOKEN") == "" {
			// The token in the file was revoked on the settings page.
			_ = os.Remove(c.tokenPath())
			if err := c.mint(ctx); err != nil {
				return err
			}
			continue
		}
		if res.StatusCode == http.StatusUnauthorized {
			// A token this run minted into this data directory's database
			// and a panel that still says no: that panel is not this data
			// directory's. Two instances on one machine, or a stale URL.
			return fmt.Errorf("the panel at %s does not accept this data directory's token; is it another panel? (VIBEPANEL_CLI_URL names the right one)", c.base)
		}
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			var e struct {
				Error string `json:"error"`
			}
			_ = json.Unmarshal(raw, &e)
			return &apiError{Status: res.StatusCode, Message: e.Error}
		}
		if out != nil && len(raw) > 0 {
			return json.Unmarshal(raw, out)
		}
		return nil
	}
}

func trimDial(err error) string {
	msg := err.Error()
	if i := strings.LastIndex(msg, ": "); i >= 0 {
		return msg[i+2:]
	}
	return msg
}

// ─── what the panel shows, resolved by name ──────────────────────────────

// panelState is the part of GET /api/state the CLI reads. Restated here
// rather than importing the server's type: the CLI is a client, and what it
// depends on should be what any client can depend on.
type panelState struct {
	Projects []store.Project `json:"projects"`
	Sessions []store.Session `json:"sessions"`
	Live     []string        `json:"live"`
	Archived []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Path string `json:"path"`
	} `json:"archived"`
	Fullscreen []string `json:"fullscreen"`
	Frozen     []string `json:"frozen"`
}

func (c *panelClient) state(ctx context.Context) (panelState, error) {
	var st panelState
	err := c.do(ctx, http.MethodGet, "/api/state", nil, &st)
	return st, err
}

// project resolves an id, an exact name, a directory, or an unambiguous
// prefix of a name to a project. A name that matches two projects is an
// error naming both rather than a guess.
func (c *panelClient) project(ctx context.Context, ref string) (store.Project, error) {
	st, err := c.state(ctx)
	if err != nil {
		return store.Project{}, err
	}
	return pickProject(st.Projects, ref)
}

func pickProject(list []store.Project, ref string) (store.Project, error) {
	ref = strings.TrimSpace(ref)
	abs, _ := filepath.Abs(ref)
	var prefix []store.Project
	for _, p := range list {
		if p.ID == ref || p.Name == ref || (abs != "" && filepath.Clean(p.Path) == abs) {
			return p, nil
		}
		if strings.HasPrefix(strings.ToLower(p.Name), strings.ToLower(ref)) {
			prefix = append(prefix, p)
		}
	}
	switch len(prefix) {
	case 1:
		return prefix[0], nil
	case 0:
		return store.Project{}, fmt.Errorf("no project %q (an id, a name, a name's start, or a directory)", ref)
	}
	names := make([]string, 0, len(prefix))
	for _, p := range prefix {
		names = append(names, p.Name+" ("+p.ID+")")
	}
	return store.Project{}, fmt.Errorf("%q names more than one project: %s", ref, strings.Join(names, ", "))
}

// session resolves an id, an exact title or an unambiguous title prefix,
// optionally within one project.
func (c *panelClient) session(ctx context.Context, ref string) (store.Session, error) {
	st, err := c.state(ctx)
	if err != nil {
		return store.Session{}, err
	}
	return pickSession(st.Sessions, ref)
}

func pickSession(list []store.Session, ref string) (store.Session, error) {
	ref = strings.TrimSpace(ref)
	var prefix []store.Session
	for _, s := range list {
		if s.ID == ref || s.Title == ref || s.TmuxName == ref {
			return s, nil
		}
		if strings.HasPrefix(strings.ToLower(s.Title), strings.ToLower(ref)) {
			prefix = append(prefix, s)
		}
	}
	switch len(prefix) {
	case 1:
		return prefix[0], nil
	case 0:
		return store.Session{}, fmt.Errorf("no session %q (an id, a title, or a title's start)", ref)
	}
	names := make([]string, 0, len(prefix))
	for _, s := range prefix {
		names = append(names, s.Title+" ("+s.ID+")")
	}
	return store.Session{}, fmt.Errorf("%q names more than one session: %s", ref, strings.Join(names, ", "))
}

// attachResult is what a send answers.
type attachResult struct {
	Name     string `json:"name"`
	Bytes    int64  `json:"bytes"`
	Size     string `json:"size"`
	URL      string `json:"url"`
	Contacts int    `json:"contacts"`
}

// uploadFile posts one file as multipart with a caption, for `me send` and
// `session attach`, streaming it rather than reading it into memory.
func uploadFile(ctx context.Context, client *http.Client, target string, headers map[string]string, path, caption string, out any) error {
	f, err := os.Open(path) //nolint:gosec // the person named it
	if err != nil {
		return err
	}
	defer f.Close()
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		defer pw.Close()
		if caption != "" {
			_ = mw.WriteField("caption", caption)
		}
		part, err := mw.CreateFormFile("file", filepath.Base(path))
		if err != nil {
			pw.CloseWithError(err)
			return
		}
		if _, err := io.Copy(part, f); err != nil {
			pw.CloseWithError(err)
			return
		}
		pw.CloseWithError(mw.Close())
	}()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, pr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("the panel did not answer: %s", trimDial(err))
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return &apiError{Status: res.StatusCode, Message: e.Error}
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}
