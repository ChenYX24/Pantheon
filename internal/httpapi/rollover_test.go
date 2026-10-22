package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/agentctx"
	"github.com/jiangmuran/vibepanel/internal/resources"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

func rolloverFixture(t *testing.T) (*Server, store.Session, *rolloverHooks, *[]string) {
	t.Helper()
	s := newInProcessTestServer(t)
	ctx := context.Background()
	p, err := s.DB.CreateProject(ctx, "p", "project", s.Cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	row, err := s.DB.CreateSession(ctx, store.Session{ID: "agent", ProjectID: p.ID, TmuxName: "vp_fake", Title: "A session", CWD: p.Path, State: session.StateDone, LaunchCommand: []string{"codex"}, LaunchProfileID: "profile"})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 11, 12, 30, 0, 0, time.FixedZone("UTC+8", 8*3600))
	steps := []string{}
	ended := false
	h := &rolloverHooks{
		now:    func() time.Time { return now },
		wait:   func(_ context.Context, d time.Duration) error { now = now.Add(d); return nil },
		memory: func() (uint64, uint64) { return 8 << 30, 4 << 30 },
		held: func(store.Session) uint64 {
			current, err := s.DB.GetSession(ctx, row.ID)
			if err != nil || current.ArchivedAt != nil {
				t.Error("memory must be measured before archiving", err)
			}
			if ended {
				return 0
			}
			return 512 << 20
		},
		send: func(_ context.Context, row store.Session, text string) error {
			steps = append(steps, "send:"+row.ID+":"+text)
			return nil
		},
		capture: func(_ context.Context, _ store.Session, n int) (string, error) {
			return fmt.Sprintf("last output (%d)", n), nil
		},
		end: func(_ context.Context, row store.Session) error {
			if _, err := s.DB.GetScrollback(ctx, row.ID); err != nil {
				t.Error("ended before scrollback was saved", err)
			}
			if data, err := os.ReadFile(s.rolloverStatus(row.ID).Handoff); err != nil || len(data) == 0 {
				t.Error("ended without handoff", err)
			}
			steps = append(steps, "end")
			ended = true
			return nil
		},
		create: func(ctx context.Context, old store.Session) (store.Session, error) {
			steps = append(steps, "create:"+strings.Join(old.LaunchCommand, " ")+":"+old.LaunchProfileID)
			return s.DB.CreateSession(ctx, store.Session{ID: "new", ProjectID: old.ProjectID, TmuxName: "vp_new", LaunchCommand: old.LaunchCommand, LaunchProfileID: old.LaunchProfileID})
		},
		ready: func(context.Context, store.Session) (bool, error) { steps = append(steps, "ready"); return true, nil },
	}
	s.rollovers.hooks = h
	policy := resources.DefaultPolicy()
	policy.RolloverGraceSeconds = 8
	if err = s.savePolicy(ctx, policy); err != nil {
		t.Fatal(err)
	}
	return s, row, h, &steps
}

func TestRolloverFallbackArchiveReportAndResume(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	base := homeFixture(t, s)
	ackRolloverByLabel(t, s, h)
	started := h.now()
	w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover", `{"reason":"long","resume":true}`, true)
	result := homeDecode[rolloverStatus](t, w, 200)
	if result.NewSessionID != "new" {
		t.Fatal(result)
	}
	if !strings.HasPrefix(result.Handoff, filepath.Join(base, "agent-docs", "handoffs")) {
		t.Fatal(result.Handoff)
	}
	data, err := os.ReadFile(result.Handoff)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"generated_by: pantheon (agent did not answer)", "A session", "project", row.CWD, "codex", "last output (200)", "git status --short", "git log --oneline -5", "long"} {
		if !strings.Contains(string(data), want) {
			t.Errorf("fallback missing %q", want)
		}
	}
	if h.now().Sub(started) != 8*time.Second+10*time.Minute {
		t.Fatal("grace and retention", h.now().Sub(started))
	}
	archived, err := s.DB.GetSession(context.Background(), row.ID)
	if err != nil {
		t.Fatal(err)
	}
	if archived.ArchivedAt == nil || archived.ArchiveNote != "rolled over → "+result.Handoff || archived.RestoreOnBoot || !archived.Exited {
		t.Fatal(archived)
	}
	files, err := os.ReadDir(filepath.Join(base, "agent-docs", "reports"))
	if err != nil || len(files) != 1 {
		t.Fatal(files, err)
	}
	report, _ := os.ReadFile(filepath.Join(base, "agent-docs", "reports", files[0].Name()))
	for _, want := range []string{"kind: report", "needs_user: false", "freed memory: 512.0 MiB", result.Handoff} {
		if !strings.Contains(string(report), want) {
			t.Errorf("report missing %q: %s", want, report)
		}
	}
	if len(*steps) != 5 || (*steps)[1] != "create:codex:profile" || (*steps)[2] != "ready" || (*steps)[3] != "send:new:"+handoffAckPrompt(result.Handoff) || (*steps)[4] != "end" {
		t.Fatal(*steps)
	}
	// The agent is asked for a draft in its own workspace; the resumed session
	// is pointed at the final handoff.
	if (*steps)[0] != "send:agent:"+handoffPrompt("long", rolloverDraftPath(row.CWD, "", row.ID)) {
		t.Fatal((*steps)[0])
	}
	select {
	case ev := <-s.eventChan():
		if ev.SessionID != row.ID || ev.To != session.StateDone {
			t.Fatal(ev)
		}
	default:
		t.Fatal("no session event")
	}
	status := homeDecode[rolloverStatus](t, homeRequest(t, s, "GET", "/api/sessions/agent/rollover", "", true), 200)
	if status.State != "done" {
		t.Fatal(status)
	}
}

func TestRolloverCompletion(t *testing.T) {
	for _, mode := range []string{"file", "marker", "echo", "critical", "shell"} {
		t.Run(mode, func(t *testing.T) {
			s, _, h, steps := rolloverFixture(t)
			started := h.now()
			if mode == "file" {
				h.send = func(_ context.Context, r store.Session, text string) error {
					*steps = append(*steps, text)
					return os.WriteFile(rolloverDraftPath(r.CWD, "", r.ID), []byte(strings.Repeat("saved work\n", 30)), 0600)
				}
			}
			if mode == "marker" {
				h.capture = func(context.Context, store.Session, int) (string, error) {
					if s.rolloverStatus("agent").State == "asking" {
						return "", nil
					}
					return "\x1b[32m⏺ HANDOFF-DONE\x1b[0m\n", nil
				}
			}
			if mode == "echo" {
				h.capture = func(context.Context, store.Session, int) (string, error) { return handoffPrompt("manual", "path"), nil }
			}
			if mode == "critical" {
				h.memory = func() (uint64, uint64) { return 8 << 30, 1 }
				_ = s.DB.SetSessionState(context.Background(), "agent", session.StateWorking, session.SourceManual)
			}
			if mode == "shell" {
				_, err := s.DB.SQL().Exec(`UPDATE sessions SET launch_command = '[]', command = 'bash' WHERE id = 'agent'`)
				if err != nil {
					t.Fatal(err)
				}
			}
			result, err := s.runRollover(context.Background(), "agent", rolloverRequest{Reason: "memory"}, 0)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(result.Handoff, filepath.Join(s.Cfg.DataDir, "handoffs")) {
				t.Fatal(result.Handoff)
			}
			elapsed := h.now().Sub(started)
			want := time.Duration(0)
			if mode == "file" {
				want = 5 * time.Second
			}
			if mode == "echo" {
				want = 8 * time.Second
			}
			if elapsed != want {
				t.Fatalf("elapsed %s want %s", elapsed, want)
			}
			if mode == "shell" && len(*steps) != 1 {
				t.Fatal("typed into shell", *steps)
			}
			if mode == "critical" && len(*steps) != 2 {
				t.Fatal("critical must still ask", *steps)
			}
		})
	}
}

func TestRolloverWorkingWaitAndConcurrentRequest(t *testing.T) {
	s, row, h, _ := rolloverFixture(t)
	if err := s.DB.SetSessionState(context.Background(), row.ID, session.StateWorking, session.SourceManual); err != nil {
		t.Fatal(err)
	}
	wait := h.wait
	calls := 0
	h.wait = func(ctx context.Context, d time.Duration) error {
		calls++
		if calls == 1 {
			w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover", `{"reason":"manual"}`, true)
			if w.Code != 409 {
				t.Fatal("concurrent", w.Code, w.Body.String())
			}
			status := homeDecode[rolloverStatus](t, homeRequest(t, s, "GET", "/api/sessions/agent/rollover", "", true), 200)
			if status.State != "asking" {
				t.Fatal(status)
			}
		}
		return wait(ctx, d)
	}
	started := h.now()
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0); err != nil {
		t.Fatal(err)
	}
	if h.now().Sub(started) != 68*time.Second {
		t.Fatal("mid-turn wait", h.now().Sub(started))
	}
}

func TestRolloverRouteGuardsAndPolicyDefaults(t *testing.T) {
	s, _, _, steps := rolloverFixture(t)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		if w := homeRequest(t, s, method, "/api/sessions/agent/rollover", `{"reason":"manual"}`, false); w.Code != 401 {
			t.Fatal(w.Code)
		}
	}
	if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover", `{"reason":"other"}`, true); w.Code != 400 {
		t.Fatal(w.Code)
	}
	s.Cfg.Development = true
	if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover", `{"reason":"manual"}`, true); w.Code != 403 {
		t.Fatal(w.Code)
	}
	s.Cfg.DevelopmentTerminal = true
	if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover", `{"reason":"manual"}`, true); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(*steps) != 2 {
		t.Fatal(*steps)
	}
	s.res.policy = nil
	if err := s.DB.SetSetting(context.Background(), resourcesPolicyKey, `{"mode":"performance"}`); err != nil {
		t.Fatal(err)
	}
	p := s.ResourcePolicy(context.Background())
	if !p.Rollover || p.IdleMinutes != 10 || p.RolloverGraceSeconds != 180 || p.AutoResume || p.Mode != resources.Performance {
		t.Fatal(p)
	}
	s.Cfg.Development = false
	body := `{"mode":"balanced","rollover":false,"idleMinutes":15,"rolloverGraceSeconds":50,"autoResume":true}`
	if w := homeRequest(t, s, "PUT", "/api/resources/policy", body, true); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	s.res.policy = nil
	p = s.ResourcePolicy(context.Background())
	if p.Rollover || p.IdleMinutes != 15 || p.RolloverGraceSeconds != 50 || !p.AutoResume {
		t.Fatal(p)
	}
	for _, body := range []string{`{"mode":"balanced","idleMinutes":-1}`, `{"mode":"balanced","rolloverGraceSeconds":0}`, `{"mode":"balanced","rolloverGraceSeconds":1801}`} {
		if w := homeRequest(t, s, "PUT", "/api/resources/policy", body, true); w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
}

type fakeRolloverTerminal struct {
	info    tmux.Info
	steps   []string
	options tmux.CreateOptions
	create  func(tmux.CreateOptions) error
}

func (f *fakeRolloverTerminal) Get(context.Context, string) (tmux.Info, error) { return f.info, nil }
func (f *fakeRolloverTerminal) Paste(_ context.Context, name, text string) error {
	f.steps = append(f.steps, "paste:"+name+":"+text)
	return nil
}
func (f *fakeRolloverTerminal) Keys(_ context.Context, name string, keys ...string) error {
	f.steps = append(f.steps, "keys:"+name+":"+strings.Join(keys, ","))
	return nil
}
func (f *fakeRolloverTerminal) CaptureLines(context.Context, string, int) (string, error) {
	return "scrollback", nil
}
func (f *fakeRolloverTerminal) Create(_ context.Context, opt tmux.CreateOptions) error {
	f.options = opt
	if f.create != nil {
		return f.create(opt)
	}
	return nil
}
func (f *fakeRolloverTerminal) ServerPID(context.Context) (int, error) {
	return 0, errors.New("no real tmux in this test")
}

func TestRolloverRealInputAndResumeAdapter(t *testing.T) {
	s, row, _, _ := rolloverFixture(t)
	s.rollovers.hooks = nil
	row.Pinned = true
	fake := &fakeRolloverTerminal{info: tmux.Info{Command: "codex"}}
	s.rollovers.terminal = fake
	h := s.rolloverRuntime()
	message := handoffPrompt("memory", "/handoff.md")
	want := "[Pantheon] 需要结束本会话（原因：内存不足）。请立即把当前工作写成交接文档，保存到 /handoff.md，使用 Markdown 标题：目标、已完成、未完成、关键文件与命令（可选）、下一步、验证命令、禁止事项。写完后只回复 HANDOFF-DONE，不要做别的事。"
	if message != want {
		t.Fatal(message)
	}
	if err := h.send(context.Background(), row, message); err != nil {
		t.Fatal(err)
	}
	if len(fake.steps) != 2 || fake.steps[0] != "paste:"+row.TmuxName+":"+want || fake.steps[1] != "keys:"+row.TmuxName+":Enter" {
		t.Fatal(fake.steps)
	}
	fake.info.Command = "bash"
	if err := h.send(context.Background(), row, "must not reach a shell"); err == nil || len(fake.steps) != 2 {
		t.Fatal("shell input", err, fake.steps)
	}
	fake.info.Command = "codex"
	_, err := s.DB.CreateLaunchProfile(context.Background(), "profile", store.LaunchProfile{Name: "profile", Command: []string{"claude"}})
	if err != nil {
		t.Fatal(err)
	}
	next, err := h.create(context.Background(), row)
	if err != nil {
		t.Fatal(err)
	}
	if !next.Pinned || next.Title != row.Title || next.ID == row.ID || next.ProjectID != row.ProjectID || next.LaunchProfileID != row.LaunchProfileID || strings.Join(fake.options.Command, " ") != "codex" || fake.options.Dir != row.CWD {
		t.Fatal(next, fake.options)
	}
	// A pane's existence alone is not readiness; the detector must see a prompt.
	if ready, err := h.ready(context.Background(), next); err != nil || ready {
		t.Fatal(ready, err)
	}
	// Without a hook a fresh agent is "working" for as long as it runs, which
	// is how every replacement on a machine without hooks timed out unasked.
	// What can be seen instead is a pane that drew something and went still.
	s.Detector = session.NewDetector()
	if ready, err := h.ready(context.Background(), next); err != nil || ready {
		t.Fatal("nothing drawn yet", ready, err)
	}
	s.Detector.Observe(next.ID, session.Signals{Visible: true}, time.Now().Add(-time.Second))
	if ready, err := h.ready(context.Background(), next); err != nil || ready {
		t.Fatal("still drawing", ready, err)
	}
	s.Detector.Observe(next.ID, session.Signals{Visible: true}, time.Now().Add(-2*rolloverReadyQuiet))
	if ready, err := h.ready(context.Background(), next); err != nil || !ready {
		t.Fatal("drawn and still", ready, err)
	}
	if err = s.DB.SetSessionState(context.Background(), next.ID, session.StateWorking, session.SourceHook); err != nil {
		t.Fatal(err)
	}
	if ready, err := h.ready(context.Background(), next); err != nil || ready {
		t.Fatal("a hook's working was overruled by quiet", ready, err)
	}
	if err = s.DB.SetSessionState(context.Background(), next.ID, session.StateWaiting, session.SourceHook); err != nil {
		t.Fatal(err)
	}
	if ready, err := h.ready(context.Background(), next); err != nil || !ready {
		t.Fatal(ready, err)
	}
	fake.info.Command = "bash"
	if ready, err := h.ready(context.Background(), next); err != nil || ready {
		t.Fatal("a shell is not a ready agent", ready, err)
	}
}

func TestRolloverPromptWaitEndsWhenTheTranscriptSaysTheTurnEnded(t *testing.T) {
	for _, tc := range []struct {
		name   string
		source session.Source
		ended  bool
		wait   time.Duration
	}{
		{"the transcript overrules the heuristic", session.SourceHeuristic, true, 0},
		{"the transcript is still mid-turn", session.SourceHeuristic, false, time.Minute},
		{"a hook says working", session.SourceHook, true, time.Minute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, base, h, _ := rolloverFixture(t)
			row, err := s.DB.CreateSession(context.Background(), store.Session{ID: "claude", ProjectID: base.ProjectID, TmuxName: "vp_claude", CWD: base.CWD, LaunchCommand: []string{"claude"}, State: session.StateWorking, StateSource: tc.source})
			if err != nil {
				t.Fatal(err)
			}
			s.contexts.publish(row.ID, agentctx.Usage{Used: 10_000, Window: 100_000, Source: agentctx.Claude, TurnEnded: tc.ended}, true)
			start, sent := h.now(), time.Time{}
			h.send = func(context.Context, store.Session, string) error { sent = h.now(); return nil }
			if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0); err != nil {
				t.Fatal(err)
			}
			if got := sent.Sub(start); got != tc.wait {
				t.Fatal("waited", got, "before the prompt, want", tc.wait)
			}
		})
	}
}

func TestRolloverWorkingGetsReplyGraceAfterThePrompt(t *testing.T) {
	s, row, h, _ := rolloverFixture(t)
	if err := s.DB.SetSessionState(context.Background(), row.ID, session.StateWorking, session.SourceManual); err != nil {
		t.Fatal(err)
	}
	start := h.now()
	sent := time.Time{}
	h.send = func(context.Context, store.Session, string) error { sent = h.now(); return nil }
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "memory"}, 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if sent.Sub(start) != time.Minute || h.now().Sub(sent) != 5*time.Second {
		t.Fatal(sent.Sub(start), h.now().Sub(sent))
	}
}

func TestRolloverStaleMarkerAndChangingFileDoNotComplete(t *testing.T) {
	s, row, h, _ := rolloverFixture(t)
	h.capture = func(context.Context, store.Session, int) (string, error) { return "HANDOFF-DONE\n", nil }
	start := h.now()
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0); err != nil {
		t.Fatal(err)
	}
	if h.now().Sub(start) != 8*time.Second {
		t.Fatal("old marker accepted")
	}
	s, row, h, _ = rolloverFixture(t)
	start = h.now()
	h.send = func(context.Context, store.Session, string) error {
		return os.WriteFile(s.rolloverStatus(row.ID).Handoff, []byte(strings.Repeat("x", 200)), 0600)
	}
	wait := h.wait
	h.wait = func(ctx context.Context, d time.Duration) error {
		if h.now().Sub(start) < 4*time.Second {
			f, err := os.OpenFile(s.rolloverStatus(row.ID).Handoff, os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				return err
			}
			_, err = f.WriteString("x")
			f.Close()
			if err != nil {
				return err
			}
		}
		return wait(ctx, d)
	}
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0); err != nil {
		t.Fatal(err)
	}
	if h.now().Sub(start) != 8*time.Second {
		t.Fatal("file still changing was accepted", h.now().Sub(start))
	}
}

func TestRolloverFallbackIncludesGitAndKeepsLast200Lines(t *testing.T) {
	s, row, h, _ := rolloverFixture(t)
	for _, args := range [][]string{{"init", "--quiet"}, {"-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "rollover fixture commit"}} {
		cmd := exec.Command("git", append([]string{"-C", row.CWD}, args...)...)
		if data, err := cmd.CombinedOutput(); err != nil {
			t.Fatal(err, string(data))
		}
	}
	if err := os.WriteFile(filepath.Join(row.CWD, "untracked.txt"), []byte("work"), 0600); err != nil {
		t.Fatal(err)
	}
	h.capture = func(context.Context, store.Session, int) (string, error) {
		return "discarded oldest line\n" + strings.Repeat("retained output\n", 200), nil
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Handoff)
	if err != nil || !strings.Contains(string(data), "?? untracked.txt") || !strings.Contains(string(data), "rollover fixture commit") || strings.Contains(string(data), "discarded oldest line") {
		t.Fatal(err, string(data))
	}
}

func TestRolloverFailurePreservesTheSessionAndCriticalInterruptsGrace(t *testing.T) {
	s, row, h, _ := rolloverFixture(t)
	h.end = func(context.Context, store.Session) error { return resources.ErrNotInSession }
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0); !errors.Is(err, resources.ErrNotInSession) {
		t.Fatal(err)
	}
	current, err := s.DB.GetSession(context.Background(), row.ID)
	if err != nil || current.ArchivedAt != nil || current.Exited || s.rolloverStatus(row.ID).State != "failed" {
		t.Fatal(current, err, s.rolloverStatus(row.ID))
	}
	s, row, h, _ = rolloverFixture(t)
	start := h.now()
	h.memory = func() (uint64, uint64) {
		if h.now().Sub(start) >= 3*time.Second {
			return 8 << 30, 1
		}
		return 8 << 30, 4 << 30
	}
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "memory"}, 0); err != nil || h.now().Sub(start) != 3*time.Second {
		t.Fatal(err, h.now().Sub(start))
	}
}

func TestRolloverInputFailureNeverEndsAnAgentUnasked(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	h.send = func(context.Context, store.Session, string) error { return errors.New("paste failed") }
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "memory"}, 0); err == nil {
		t.Fatal("input failure ignored")
	}
	if len(*steps) != 0 || s.rolloverStatus(row.ID).State != "failed" {
		t.Fatal(*steps, s.rolloverStatus(row.ID))
	}
	current, err := s.DB.GetSession(context.Background(), row.ID)
	if err != nil || current.Exited || current.ArchivedAt != nil {
		t.Fatal(current, err)
	}
}

func TestRolloverStopsWaitingWhenTheAgentExits(t *testing.T) {
	// Measured: Codex updated itself and exited right after the prompt; the
	// rollover still waited out the whole grace for a reply nobody could give.
	s, row, h, _ := rolloverFixture(t)
	start := h.now()
	h.gone = func(context.Context, store.Session) bool { return h.now().Sub(start) >= 2*time.Second }
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0)
	if err != nil || h.now().Sub(start) != 2*time.Second {
		t.Fatal(err, h.now().Sub(start))
	}
	data, err := os.ReadFile(result.Handoff)
	if err != nil || !strings.Contains(string(data), "agent did not answer") {
		t.Fatal("fallback handoff expected", err, string(data))
	}
}

func TestRolloverAsksForADraftInsideTheWorkingDirectory(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	h.send = func(_ context.Context, r store.Session, text string) error {
		*steps = append(*steps, "send:"+text)
		draft := rolloverDraftPath(r.CWD, "", r.ID)
		if !strings.Contains(text, draft) {
			t.Errorf("prompt must name the in-workspace draft %s: %s", draft, text)
		}
		return os.WriteFile(draft, []byte(strings.Repeat("agent handoff ", 20)), 0644)
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(result.Handoff)
	if err != nil || !strings.HasPrefix(string(data), "agent handoff") {
		t.Fatal("the agent's draft must become the handoff", err, string(data))
	}
	if _, err := os.Stat(rolloverDraftPath(row.CWD, "", row.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("draft left in the workspace", err)
	}
}
