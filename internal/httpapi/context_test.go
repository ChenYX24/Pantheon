package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/agentctx"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

type contextProc struct{}

func (contextProc) Comm(pid int) string {
	if pid == 20 {
		return "claude"
	}
	return ""
}
func (contextProc) Children(int) []int     { return nil }
func (contextProc) FDTargets(int) []string { return nil }

func contextFixture(t *testing.T) (*Server, store.Session, map[string]tmux.Info) {
	t.Helper()
	s := newInProcessTestServer(t)
	s.Manager = session.NewManager(nil, 256<<10)
	// Snapshot construction must never inspect the user's real hook files.
	s.hookCheckedAt = time.Now().Add(time.Hour)
	ctx := context.Background()
	if _, err := s.DB.CreateProject(ctx, "p", "context", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	row, err := s.DB.CreateSession(ctx, store.Session{ID: "s", ProjectID: "p", TmuxName: "vp_s", Command: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	return s, row, map[string]tmux.Info{row.TmuxName: {PID: 20, Command: "codex"}}
}

func contextLog(t *testing.T, path string, n int) {
	t.Helper()
	homePut(t, path, fmt.Sprintf(`{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":%d},"model_context_window":258400}}}`+"\n", n))
}

func TestContextPollThrottle(t *testing.T) {
	s, row, panes := contextFixture(t)
	row.State = session.StateDone
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	s.contexts.now = func() time.Time { return now }
	path := filepath.Join(t.TempDir(), "rollout.jsonl")
	contextLog(t, path, 62_000)
	resolves := 0
	s.contexts.findCodex = func(int) string { resolves++; return path }
	refresh := func() { s.refreshContexts(context.Background(), []store.Session{row}, panes) }
	refresh()
	first := s.contexts.snapshot([]store.Session{row})[row.ID]
	if first.Used != 62_000 || resolves != 1 {
		t.Fatalf("initial context = %+v, resolves=%d", first, resolves)
	}
	contextLog(t, path, 72_000)
	for i := 1; i < 15; i++ {
		now = now.Add(time.Second)
		refresh()
		if got := s.contexts.snapshot([]store.Session{row})[row.ID]; got != first {
			t.Fatalf("read again at %ds: %+v", i, got)
		}
	}
	now = now.Add(time.Second)
	refresh()
	if got := s.contexts.snapshot([]store.Session{row})[row.ID]; got.Used != 72_000 || resolves != 1 {
		t.Fatalf("15s reading/cache = %+v, resolves=%d", got, resolves)
	}
	stable := s.contexts.snapshot([]store.Session{row})[row.ID]
	for range 3 {
		now = now.Add(contextEvery)
		refresh()
		if got := s.contexts.snapshot([]store.Session{row})[row.ID]; got != stable || resolves != 1 {
			t.Fatalf("unchanged file changed usage or discovery: %+v, resolves=%d", got, resolves)
		}
	}
	panes[row.TmuxName] = tmux.Info{PID: 21, Command: "codex"}
	refresh()
	if resolves != 2 {
		t.Fatal("new pid reused the old rollout mapping")
	}
	s.refreshContexts(context.Background(), nil, panes)
	if len(s.contexts.entries) != 0 || len(s.contexts.snapshot([]store.Session{row})) != 0 {
		t.Fatal("removed session retained context")
	}
}

func TestContextPollEligibility(t *testing.T) {
	s, row, panes := contextFixture(t)
	s.contexts.findCodex = func(int) string { t.Fatal("ineligible session read a rollout"); return "" }
	for _, kind := range []string{"scratch", "dead", "gone", "shell"} {
		r := row
		p := map[string]tmux.Info{row.TmuxName: panes[row.TmuxName]}
		switch kind {
		case "scratch":
			r.Scratch = true
		case "dead":
			p[row.TmuxName] = tmux.Info{PID: 20, Command: "codex", Dead: true}
		case "gone":
			delete(p, row.TmuxName)
		case "shell":
			p[row.TmuxName] = tmux.Info{PID: 20, Command: "bash"}
		}
		s.refreshContexts(context.Background(), []store.Session{r}, p)
		if len(s.contexts.snapshot([]store.Session{r})) != 0 {
			t.Fatalf("%s session has context", kind)
		}
	}
}

func TestContextClaudePrefersHookAndResets(t *testing.T) {
	s, row, panes := contextFixture(t)
	panes[row.TmuxName] = tmux.Info{PID: 20, Command: "claude"}
	now := time.Now()
	s.contexts.now = func() time.Time { return now }
	s.contexts.claude.Proc = contextProc{}
	s.contexts.claude.ConfigDir = func(int) string { t.Fatal("hook path did not win"); return "" }
	path := filepath.Join(t.TempDir(), "hook.jsonl")
	homePut(t, path, `{"type":"assistant","message":{"model":"claude-opus-5-5","usage":{"input_tokens":620000}}}`+"\n")
	ctx := context.Background()
	if err := s.DB.SetSessionTranscript(ctx, row.ID, "claude", path); err != nil {
		t.Fatal(err)
	}
	s.refreshContexts(ctx, []store.Session{row}, panes)
	if got := s.contexts.snapshot([]store.Session{row})[row.ID]; got.Used != 620_000 || got.Source != agentctx.Claude {
		t.Fatalf("hook usage = %+v", got)
	}
	next := filepath.Join(t.TempDir(), "new.jsonl")
	homePut(t, next, "no usage yet\n")
	if err := s.DB.SetSessionTranscript(ctx, row.ID, "claude", next); err != nil {
		t.Fatal(err)
	}
	now = now.Add(contextEvery)
	s.refreshContexts(ctx, []store.Session{row}, panes)
	if len(s.contexts.snapshot([]store.Session{row})) != 0 {
		t.Fatal("new conversation kept the old usage")
	}
}

func TestContextClaudeWithoutHooks(t *testing.T) {
	s, row, panes := contextFixture(t)
	// Launch detection still recognises a Claude hidden behind a shell.
	row.LaunchCommand = []string{"/bin/claude"}
	panes[row.TmuxName] = tmux.Info{PID: 20, Command: "bash"}
	dir := t.TempDir()
	s.contexts.claude.Proc = contextProc{}
	s.contexts.claude.ConfigDir = func(int) string { return dir }
	homePut(t, filepath.Join(dir, "sessions", "20.json"), `{"pid":20,"sessionId":"conversation","cwd":"/fixture"}`)
	homePut(t, filepath.Join(dir, "projects", "-fixture", "conversation.jsonl"), `{"type":"assistant","message":{"model":"unknown","usage":{"input_tokens":621234}}}`+"\n")
	s.refreshContexts(context.Background(), []store.Session{row}, panes)
	if got := s.contexts.snapshot([]store.Session{row})[row.ID]; got.Used != 621_000 || got.Window != 0 || got.Source != agentctx.Claude {
		t.Fatalf("hook-free context = %+v", got)
	}
}

func TestContextSnapshotDoesNotBroadcastUnchangedUsage(t *testing.T) {
	s, row, _ := contextFixture(t)
	ctx := context.Background()
	u := agentctx.Usage{Used: 620_100, Window: 1_000_000, Model: "claude-opus-5-5", Source: agentctx.Claude, At: time.Now()}
	s.contexts.publish(row.ID, u, true)
	payload := s.changedSnapshot(ctx)
	if payload == nil {
		t.Fatal("initial snapshot was suppressed")
	}
	var socket struct {
		Type string `json:"t"`
		stateResponse
	}
	if err := json.Unmarshal(payload, &socket); err != nil || socket.Context[row.ID].Used != 620_000 {
		t.Fatalf("socket context: %s, %v", payload, err)
	}
	for _, used := range []int64{620_100, 620_400, 619_500} {
		u.Used, u.At = used, u.At.Add(time.Minute)
		s.contexts.publish(row.ID, u, true)
		if got := s.changedSnapshot(ctx); got != nil {
			t.Fatalf("unchanged rounded usage queued a broadcast: %s", got)
		}
	}
	w := httptest.NewRecorder()
	s.handleState(w, httptest.NewRequest("GET", "/api/state", nil))
	var rest stateResponse
	if err := json.Unmarshal(w.Body.Bytes(), &rest); err != nil || rest.Context[row.ID] != socket.Context[row.ID] {
		t.Fatalf("REST/socket disagreement: %s, %v", w.Body.Bytes(), err)
	}
	u.Used = 620_500
	s.contexts.publish(row.ID, u, true)
	if s.changedSnapshot(ctx) == nil {
		t.Fatal("new rounded value did not queue a broadcast")
	}
	u.Window = 200_000
	s.contexts.publish(row.ID, u, true)
	if s.changedSnapshot(ctx) == nil {
		t.Fatal("new window did not queue a broadcast")
	}
	s.contexts.publish(row.ID, agentctx.Usage{}, false)
	if s.changedSnapshot(ctx) == nil {
		t.Fatal("removed usage did not queue a broadcast")
	}
}

func TestContextSnapshotLeavesHiddenSessionsOut(t *testing.T) {
	var m contextMeter
	u := agentctx.Usage{Source: agentctx.Codex}
	for _, id := range []string{"visible", "archived", "scratch", "exited"} {
		m.publish(id, u, true)
	}
	got := m.snapshot([]store.Session{{ID: "visible"}, {ID: "scratch", Scratch: true}, {ID: "exited", Exited: true}})
	if len(got) != 1 || got["visible"].Source == "" {
		t.Fatalf("hidden sessions leaked into context: %+v", got)
	}
}
