package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/agentctx"
	"github.com/jiangmuran/vibepanel/internal/hooks"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
	"github.com/jiangmuran/vibepanel/internal/webui"
)

const statusLineDoc = `{"session_id":"x","rate_limits":{"five_hour":{"used_percentage":12,"resets_at":1793037000},"seven_day":{"used_percentage":7,"resets_at":1793062800}}}`

func quotaSessions(t *testing.T, s *Server, project string, rows ...store.Session) []store.Session {
	t.Helper()
	out := []store.Session{}
	for _, r := range rows {
		r.ProjectID = project
		row, err := s.DB.CreateSession(context.Background(), r)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, row)
	}
	return out
}

func sendQuota(t *testing.T, s *Server, id, state, token, body string) int {
	t.Helper()
	r := httptest.NewRequest("POST", "/api/hook/state?sessionId="+id+"&signal="+hooks.SignalQuota+"&state="+state+"&source=", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.handleHookState(w, r)
	return w.Code
}

// The status line's report reaches every session on the same login, and no
// session on another one, and only as checked numbers.
func TestAStatusLineReportIsTheAccountsForEverySessionOnIt(t *testing.T) {
	s, row, _ := contextFixture(t)
	rows := quotaSessions(t, s, row.ProjectID,
		store.Session{ID: "c1", TmuxName: "vp_c1", LaunchCommand: []string{"claude"}, ClaudeAccountID: "acct"},
		store.Session{ID: "c2", TmuxName: "vp_c2", LaunchCommand: []string{"claude"}, ClaudeAccountID: "acct"},
		store.Session{ID: "c3", TmuxName: "vp_c3", LaunchCommand: []string{"claude"}},
	)
	panes := map[string]tmux.Info{}
	for i, r := range rows {
		panes[r.TmuxName] = tmux.Info{PID: 30 + i, Command: "claude"}
	}
	s.refreshContexts(context.Background(), rows, panes)
	root, err := s.HookToken(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		state, token, body string
		want               int
	}{
		{"", "wrong", statusLineDoc, 401},
		{"done", root, statusLineDoc, 400},
		// Unreadable or limitless documents are dropped quietly: a status
		// line must not learn to retry.
		{"", root, `{"session_id":"x"}`, 204},
		{"", root, strings.Replace(statusLineDoc, `"used_percentage":12`, `"used_percentage":-12`, 1), 204},
	} {
		if code := sendQuota(t, s, "c1", tc.state, tc.token, tc.body); code != tc.want {
			t.Fatalf("%+v: %d", tc, code)
		}
		if got := s.quotas.snapshot(rows); len(got) != 0 {
			t.Fatalf("%+v reached the snapshot: %+v", tc, got)
		}
	}
	if code := sendQuota(t, s, "c1", "", hooks.ReportToken(root, "c1"), statusLineDoc); code != 204 {
		t.Fatal(code)
	}
	got := s.quotas.snapshot(rows)
	if len(got) != 2 || got["c1"].Limits[0].Used != 12 || got["c2"].Limits[1].Used != 7 {
		t.Fatalf("one login's limits: %+v", got)
	}
	if _, ok := got["c3"]; ok {
		t.Fatal("another login was given this one's limits")
	}
	state, err := s.buildState(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(state)
	if !strings.Contains(string(b), `"quota":{"c1":{"limits":[{"minutes":300,"used":12,"resetsAt":1793037000}`) {
		t.Fatalf("snapshot: %s", b)
	}
}

// Two Codex sessions on one login are read in turn by the poller, and the one
// read last is not the one written last: the newer reading stays.
func TestTheFresherCodexReadingWinsWhicheverIsReadLast(t *testing.T) {
	s, row, _ := contextFixture(t)
	home := t.TempDir()
	newer := filepath.Join(home, "sessions", "2026", "10", "26", "rollout-a.jsonl")
	older := filepath.Join(home, "sessions", "2026", "10", "25", "rollout-b.jsonl")
	line := func(at string, used int) string {
		return fmt.Sprintf(`{"timestamp":%q,"type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"codex","primary":{"used_percent":%d.0,"window_minutes":10080,"resets_at":1793523155},"plan_type":"pro"}}}`+"\n", at, used)
	}
	homePut(t, newer, line("2026-10-26T10:00:00Z", 9))
	homePut(t, older, line("2026-10-25T10:00:00Z", 4))
	rows := []store.Session{row}
	rows = append(rows, quotaSessions(t, s, row.ProjectID, store.Session{ID: "s2", TmuxName: "vp_s2", Command: "codex"})...)
	paths := map[int]string{20: newer, 21: older}
	s.contexts.findCodex = func(pid int) string { return paths[pid] }
	s.refreshContexts(context.Background(), rows, map[string]tmux.Info{"vp_s": {PID: 20, Command: "codex"}, "vp_s2": {PID: 21, Command: "codex"}})
	got := s.quotas.snapshot(rows)
	if got["s"].Limits[0].Used != 9 || got["s2"].Limits[0].Used != 9 || got["s"].Plan != "pro" {
		t.Fatalf("%+v", got)
	}
	if codexAccount(newer) != "codex:"+home || codexAccount(older) != codexAccount(newer) {
		t.Fatal(codexAccount(newer), codexAccount(older))
	}
}

// Readings that differ only in time do not resend every viewer the snapshot.
func TestAnUnchangedQuotaDoesNotBroadcast(t *testing.T) {
	var m quotaMeter
	q, _ := agentctx.ClaudeLimits([]byte(statusLineDoc), time.Unix(100, 0))
	if !m.observe("a", q, time.Unix(100, 0)) {
		t.Fatal("first reading did not count")
	}
	later, _ := agentctx.ClaudeLimits([]byte(statusLineDoc), time.Unix(200, 0))
	if m.observe("a", later, time.Unix(200, 0)) {
		t.Fatal("same figures counted as a change")
	}
	m.bind("x", "a")
	if got := m.snapshot([]store.Session{{ID: "x"}})["x"]; !got.At.Equal(time.Unix(100, 0)) {
		t.Fatalf("At moved without the figures: %v", got.At)
	}
	moved, _ := agentctx.ClaudeLimits([]byte(strings.Replace(statusLineDoc, `"used_percentage":12`, `"used_percentage":13`, 1)), time.Unix(50, 0))
	if m.observe("a", moved, time.Unix(50, 0)) {
		t.Fatal("an older reading replaced a newer one")
	}
}

func TestTheSnapshotNamesTheEmbeddedBundleOnlyWhenItIsServed(t *testing.T) {
	s, _, _ := contextFixture(t)
	s.Cfg.StaticDir = ""
	if s.bundle() != webui.Entry() || s.bundle() == "" {
		t.Fatal(s.bundle(), webui.Entry())
	}
	s.Cfg.StaticDir = t.TempDir()
	if s.bundle() != "" {
		t.Fatal("a frontend served from disk was named after the embedded one")
	}
}

// A status line reports for whatever session it runs in, and the poller does
// not recognise every one of them as an agent (a claude typed into a shell).
// The report must outlive the next tick; it must not outlive the session.
func TestAReportOutlivesThePollButNotTheSession(t *testing.T) {
	s, row, _ := contextFixture(t)
	shell := quotaSessions(t, s, row.ProjectID, store.Session{ID: "sh", TmuxName: "vp_sh", Command: "bash"})[0]
	root, err := s.HookToken(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if code := sendQuota(t, s, "sh", "", root, statusLineDoc); code != 204 {
		t.Fatal(code)
	}
	rows := []store.Session{shell}
	s.refreshContexts(context.Background(), rows, map[string]tmux.Info{"vp_sh": {PID: 40, Command: "bash"}})
	if _, ok := s.quotas.snapshot(rows)["sh"]; !ok {
		t.Fatal("a tick dropped the report of a session it does not call an agent")
	}
	s.refreshContexts(context.Background(), rows, map[string]tmux.Info{})
	if _, ok := s.quotas.snapshot(rows)["sh"]; ok {
		t.Fatal("an ended session kept its account's limits")
	}
}
