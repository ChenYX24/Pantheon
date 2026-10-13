package main

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/auth"
	"github.com/jiangmuran/vibepanel/internal/config"
	"github.com/jiangmuran/vibepanel/internal/hooks"
	"github.com/jiangmuran/vibepanel/internal/httpapi"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/sysmon"
	"github.com/jiangmuran/vibepanel/internal/tmux"
	"github.com/jiangmuran/vibepanel/internal/ws"
)

// The CLI against a real panel: an httpapi.Server on a throwaway tmux
// socket and database, with an account made through the setup route, and
// the commands pointed at it through the two environment variables a
// container would set. What is checked is that each command reaches the
// panel's own handler -- the rename shows in the state, the text typed
// shows on the screen -- rather than that it printed something.

type cliPanel struct {
	ts  *httptest.Server
	db  *store.DB
	dir string
	srv *httpapi.Server
}

func startCLIPanel(t *testing.T) *cliPanel { return startCLIPanelWith(t, true) }

// startCLIPanelWith starts the panel and, with an account, finishes setup.
func startCLIPanelWith(t *testing.T, withAccount bool) *cliPanel {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	ctx := context.Background()
	dir := t.TempDir()
	socket := "vibepanel-test-cli-" + strconv.Itoa(os.Getpid()) + "-" + strconv.FormatInt(time.Now().UnixNano()%100000, 10)
	tm := tmux.New(socket, dir)
	if bin := os.Getenv("TEST_TMUX_BIN"); bin != "" {
		tm.Bin = bin
	}
	if err := tm.EnsureServer(ctx); err != nil {
		t.Fatalf("tmux: %v", err)
	}
	t.Cleanup(func() {
		_ = tm.KillServer(context.Background())
		_ = os.Remove(tm.SocketPath())
	})
	cfg := config.Config{DataDir: dir, Addr: ":0", TmuxSocket: socket, StaticDir: dir}
	db, err := store.Open(ctx, cfg.DBPath())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	mgr := session.NewManager(tm, 256<<10)
	t.Cleanup(mgr.DetachAll)
	srv := &httpapi.Server{
		Cfg: cfg, DB: db, Tmux: tm, Manager: mgr, Hub: ws.NewHub(), Detector: session.NewDetector(),
		Sampler: &sysmon.Sampler{DiskPath: dir},
		Auth:    &httpapi.Auth{Throttle: auth.NewThrottle(), SetupToken: "cli-setup-token"},
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	ts := httptest.NewServer(srv.Routes())
	t.Cleanup(ts.Close)
	if withAccount {
		res, err := http.Post(ts.URL+"/api/auth/setup", "application/json",
			strings.NewReader(`{"token":"cli-setup-token","username":"tester","password":"a sufficiently long password"}`))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("setup: %d", res.StatusCode)
		}
	}
	t.Setenv("VIBEPANEL_DATA_DIR", dir)
	t.Setenv("VIBEPANEL_TMUX_SOCKET", socket)
	t.Setenv("VIBEPANEL_CLI_URL", ts.URL)
	t.Setenv("VIBEPANEL_CLI_TOKEN", "")
	return &cliPanel{ts: ts, db: db, dir: dir, srv: srv}
}

// run executes one command and returns what it printed.
func runCLI(t *testing.T, args ...string) (string, error) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stdout
	os.Stdout = w
	var buf bytes.Buffer
	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(&buf, r)
		close(done)
	}()
	cmdErr := commands[args[0]](args[1:])
	os.Stdout = old
	w.Close()
	<-done
	return buf.String(), cmdErr
}

func mustRun(t *testing.T, args ...string) string {
	t.Helper()
	out, err := runCLI(t, args...)
	if err != nil {
		t.Fatalf("%s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return out
}

func TestTheCLIOperatesTheRunningPanel(t *testing.T) {
	p := startCLIPanel(t)
	ctx := context.Background()
	work := t.TempDir()

	// Projects: add, rename, pin, order, archive, restore -- each visible in
	// the panel's own state afterwards.
	out := mustRun(t, "project", "add", work, "--name", "Alpha")
	if !strings.Contains(out, "created project") {
		t.Fatalf("add: %s", out)
	}
	mustRun(t, "project", "add", t.TempDir(), "--name", "Beta")
	mustRun(t, "project", "rename", "Alp", "Alpha Prime")
	mustRun(t, "project", "pin", "Alpha Prime")
	projects, _ := p.db.ListProjects(ctx)
	var alpha store.Project
	for _, pr := range projects {
		if pr.Name == "Alpha Prime" {
			alpha = pr
		}
	}
	if alpha.ID == "" || !alpha.Pinned {
		t.Fatalf("after rename and pin: %+v", projects)
	}
	if _, err := runCLI(t, "project", "rename", "nothing-here", "x"); err == nil || !strings.Contains(err.Error(), "no project") {
		t.Errorf("an unknown project: %v", err)
	}
	mustRun(t, "project", "order", "Beta", "Alpha Prime")
	if out := mustRun(t, "project", "ls"); !strings.Contains(out, "Alpha Prime *") || !strings.Contains(out, "Beta") {
		t.Errorf("ls: %s", out)
	}
	mustRun(t, "project", "archive", "Beta")
	if out := mustRun(t, "project", "ls"); !strings.Contains(out, "archived") {
		t.Errorf("ls after archive: %s", out)
	}
	mustRun(t, "project", "restore", "Beta")

	// The CLI's token is a row on the settings page and a 0600 file.
	tokens, _ := p.db.ListAPITokens(ctx)
	if len(tokens) != 1 || tokens[0].Name != "cli" {
		t.Fatalf("tokens: %+v", tokens)
	}
	if info, err := os.Stat(filepath.Join(p.dir, cliTokenFile)); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("token file: %v %v", info, err)
	}

	// Sessions: new, rename, send, screen, state, kill.
	out = mustRun(t, "session", "new", "--project", "Alpha Prime", "--title", "shell", "--", "sh")
	if !strings.Contains(out, "created session") {
		t.Fatalf("new: %s", out)
	}
	sessions, _ := p.db.ListSessions(ctx)
	if len(sessions) != 1 || sessions[0].Title != "shell" {
		t.Fatalf("sessions: %+v", sessions)
	}
	mustRun(t, "session", "rename", "shell", "the shell")
	mustRun(t, "session", "send", "the shell", "echo cli-was-here", "--enter")
	deadline := time.Now().Add(5 * time.Second)
	var screen string
	for time.Now().Before(deadline) {
		screen = mustRun(t, "session", "screen", "the shell")
		if strings.Contains(screen, "cli-was-here") {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !strings.Contains(screen, "cli-was-here") {
		t.Errorf("the typed text is not on the screen:\n%s", screen)
	}
	mustRun(t, "session", "state", "the shell", "waiting")
	mustRun(t, "session", "pin", "the shell")
	if out := mustRun(t, "status"); !strings.Contains(out, "▲ waiting") || !strings.Contains(out, "the shell") || !strings.Contains(out, "pinned") {
		t.Errorf("status: %s", out)
	}
	mustRun(t, "session", "kill", "the shell")
	if sessions, _ := p.db.ListSessions(ctx); len(sessions) != 0 {
		t.Errorf("after kill: %+v", sessions)
	}

	// Notes and todos.
	mustRun(t, "note", "set", "Alpha Prime", "remember the milk")
	if out := mustRun(t, "note", "get", "Alpha Prime"); !strings.Contains(out, "remember the milk") {
		t.Errorf("note: %s", out)
	}
	mustRun(t, "todo", "add", "Alpha Prime", "buy milk")
	mustRun(t, "todo", "add", "Alpha Prime", "drink it")
	mustRun(t, "todo", "done", "Alpha Prime", "buy")
	if out := mustRun(t, "todo", "ls", "Alpha Prime"); !strings.Contains(out, "[x]  buy milk") || !strings.Contains(out, "[ ]  drink it") {
		t.Errorf("todos: %s", out)
	}
	mustRun(t, "todo", "rm", "Alpha Prime", "drink")

	// Tokens and the log. Revoking the CLI's own token locks nothing for
	// long: the next command mints another.
	minted := mustRun(t, "token", "create", "a script")
	if len(strings.TrimSpace(minted)) < 20 {
		t.Errorf("create: %q", minted)
	}
	if out := mustRun(t, "token", "ls"); !strings.Contains(out, "a script") || !strings.Contains(out, "cli") {
		t.Errorf("tokens: %s", out)
	}
	mustRun(t, "token", "revoke", "cli")
	if _, err := os.Stat(filepath.Join(p.dir, cliTokenFile)); err == nil {
		t.Error("the file outlived the revocation")
	}
	mustRun(t, "settings", "archive-idle", "14")
	tokens, _ = p.db.ListAPITokens(ctx)
	names := []string{}
	for _, tk := range tokens {
		names = append(names, tk.Name)
	}
	if !strings.Contains(strings.Join(names, ","), "cli") {
		t.Errorf("no new cli token after the revocation: %v", names)
	}
	out = mustRun(t, "audit", "-n", "200")
	if !strings.Contains(out, "session.input") || !strings.Contains(out, "project.archived") {
		t.Errorf("audit: %s", out)
	}
	if strings.Index(out, "setup.completed") > strings.Index(out, "session.input") {
		t.Errorf("the log is not oldest first:\n%s", out)
	}
}

// Without a panel, the subcommands the first CLI had still work on the
// database, and say so; the ones that need the panel say it is not running.
func TestTheCLIFallsBackWhenThePanelIsDown(t *testing.T) {
	p := startCLIPanel(t)
	mustRun(t, "project", "add", t.TempDir(), "--name", "Gamma")
	p.ts.Close()
	// A port nothing listens on.
	t.Setenv("VIBEPANEL_CLI_URL", "http://127.0.0.1:1")
	if out := mustRun(t, "project", "ls"); !strings.Contains(out, "Gamma") {
		t.Errorf("ls offline: %s", out)
	}
	if _, err := runCLI(t, "project", "rename", "Gamma", "Delta"); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Errorf("rename offline: %v", err)
	}
	if _, err := runCLI(t, "status"); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Errorf("status offline: %v", err)
	}
}

// A data directory with no panel.url and no VIBEPANEL_CLI_URL is one whose
// panel is not running, whatever listens on the default port: the CLI
// works on the database and never knocks on another panel's door.
func TestTheCLIReadsThePanelsAddressFromItsDataDirectory(t *testing.T) {
	p := startCLIPanel(t)
	mustRun(t, "project", "add", t.TempDir(), "--name", "Omega")
	os.Unsetenv("VIBEPANEL_CLI_URL")
	if out := mustRun(t, "project", "ls"); !strings.Contains(out, "Omega") {
		t.Errorf("ls with no address: %s", out)
	}
	if _, err := runCLI(t, "status"); err == nil || !strings.Contains(err.Error(), panelURLFile) {
		t.Errorf("status with no address: %v", err)
	}
	// The file the panel writes is what points the CLI at it.
	if err := os.WriteFile(filepath.Join(p.dir, panelURLFile), []byte(p.ts.URL+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if out := mustRun(t, "status"); !strings.Contains(out, "Omega") {
		t.Errorf("status through panel.url: %s", out)
	}
}

// Before setup there is no account to mint a token for; a running panel is
// then no better than none, and the commands that can work on the database
// do, which is what `project add` and `session new` always did before the
// first account.
func TestBeforeSetupTheCLIWorksOnTheDatabase(t *testing.T) {
	p := startCLIPanelWith(t, false)
	out := mustRun(t, "project", "add", t.TempDir(), "--name", "Early")
	if !strings.Contains(out, "created project") {
		t.Fatalf("add: %s", out)
	}
	projects, _ := p.db.ListProjects(context.Background())
	if len(projects) != 1 || projects[0].Name != "Early" {
		t.Errorf("projects: %+v", projects)
	}
	if _, err := runCLI(t, "project", "rename", "Early", "Late"); err == nil || !strings.Contains(err.Error(), "no account") {
		t.Errorf("rename before setup: %v", err)
	}
	if tokens, _ := p.db.ListAPITokens(context.Background()); len(tokens) != 0 {
		t.Errorf("a token was minted with no account: %+v", tokens)
	}
}

// `vibepanel me` from inside a session: the environment the panel gave the
// session is the whole configuration, and what it says shows on the owner's
// side -- in the state and under the row.
func TestMeSpeaksForTheSessionItRunsIn(t *testing.T) {
	p := startCLIPanel(t)
	ctx := context.Background()
	mustRun(t, "project", "add", t.TempDir(), "--name", "Voice")
	mustRun(t, "session", "new", "--project", "Voice", "--title", "agent", "--", "sleep", "60")
	sessions, _ := p.db.ListSessions(ctx)
	if len(sessions) != 1 {
		t.Fatalf("sessions: %+v", sessions)
	}
	root, err := p.srv.HookToken(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIBEPANEL_SESSION_ID", sessions[0].ID)
	t.Setenv("VIBEPANEL_TOKEN", hooks.ReportToken(root, sessions[0].ID))
	t.Setenv("VIBEPANEL_URL", p.ts.URL)
	if out := mustRun(t, "me"); !strings.Contains(out, "agent") || !strings.Contains(out, "Voice") {
		t.Errorf("me: %s", out)
	}
	mustRun(t, "me", "state", "waiting", "--why", "which table to drop")
	mustRun(t, "me", "info", "set", "summary", "3 of 5 done, blocked on the migration")
	mustRun(t, "me", "info", "set", "progress", "60%")
	mustRun(t, "me", "info", "set", "labels", "db,migration")
	mustRun(t, "me", "title", "schema work")
	row, _ := p.db.GetSession(ctx, sessions[0].ID)
	if row.State != "waiting" || row.Summary != "3 of 5 done, blocked on the migration" || row.Progress != 60 || strings.Join(row.Labels, ",") != "db,migration" || row.Title != "schema work" {
		t.Errorf("row: %+v", row)
	}
	if last, ok, _ := p.db.LatestSessionMessage(ctx, row.ID); !ok || last.Text != "which table to drop" {
		t.Errorf("why: %+v", last)
	}
	if out := mustRun(t, "status"); !strings.Contains(out, "▲ waiting") || !strings.Contains(out, "schema work") {
		t.Errorf("status: %s", out)
	}
	// The owner's side of the same fields, and clearing.
	t.Setenv("VIBEPANEL_SESSION_ID", "")
	mustRun(t, "session", "info", "schema", "clear")
	row, _ = p.db.GetSession(ctx, sessions[0].ID)
	if row.Summary != "" || row.Progress != -1 || len(row.Labels) != 0 {
		t.Errorf("after clear: %+v", row)
	}
	if out := mustRun(t, "me", "guide"); !strings.Contains(out, "me state waiting") {
		t.Errorf("guide: %s", out)
	}
	// Outside a session there is nothing to speak for.
	t.Setenv("VIBEPANEL_TOKEN", "")
	if _, err := runCLI(t, "me"); err == nil || !strings.Contains(err.Error(), "inside a session") {
		t.Errorf("me outside a session: %v", err)
	}
}
