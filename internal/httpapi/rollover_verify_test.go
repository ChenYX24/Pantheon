package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/hooks"
	"github.com/jiangmuran/vibepanel/internal/rollover"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func ackRolloverByLabel(t *testing.T, s *Server, h *rolloverHooks) {
	t.Helper()
	send := h.send
	h.send = func(ctx context.Context, row store.Session, text string) error {
		if err := send(ctx, row, text); err != nil {
			return err
		}
		if row.ID == "new" {
			summary := strings.Repeat("下一步", 100)
			return s.DB.SetSessionInfo(ctx, row.ID, &summary, nil, []string{"handoff-ack"})
		}
		return nil
	}
}

func assertRolloverIntact(t *testing.T, s *Server, steps []string) {
	t.Helper()
	row, err := s.DB.GetSession(context.Background(), "agent")
	if err != nil || row.Exited || row.ArchivedAt != nil || slices.Contains(steps, "end") {
		t.Fatalf("old session was released: exited=%v archived=%v steps=%v err=%v", row.Exited, row.ArchivedAt, steps, err)
	}
}

func rolloverAudit(t *testing.T, s *Server, event string) map[string]any {
	t.Helper()
	entries, err := s.DB.RecentAuditPrefix(context.Background(), "rollover.", 100)
	if err != nil {
		t.Fatal(err)
	}
	var found map[string]any
	for _, e := range entries {
		if e.Event == "rollover."+event {
			if found != nil {
				t.Fatalf("duplicate %s audit", event)
			}
			if err := json.Unmarshal([]byte(e.Detail), &found); err != nil {
				t.Fatal(err)
			}
		}
	}
	if found == nil {
		t.Fatalf("missing rollover.%s: %+v", event, entries)
	}
	return found
}

func rolloverPairViews(t *testing.T, s *Server, state rollover.State) rollover.View {
	t.Helper()
	rows, err := s.DB.ListSessions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	views := s.autoRolloverSnapshot(rows)
	old, next := views["agent"], views["new"]
	want := rollover.Verifying
	if state == rollover.HandedOff {
		want = rollover.Confirmed
	}
	if old.State != state || old.NewSessionID != "new" || next.State != want || next.Replaces != "agent" {
		t.Fatalf("pair views: %+v", views)
	}
	if !s.RollingOver("agent") || !s.RollingOver("new") {
		t.Fatal("both sessions must be busy")
	}
	return old
}

func TestRolloverLabelAckDeadlineViewsAndFreshScrollback(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	ackRolloverByLabel(t, s, h)
	wait := h.wait
	var deadline int64
	verified, handed := false, false
	h.ready = func(context.Context, store.Session) (bool, error) {
		rolloverPairViews(t, s, rollover.Verifying)
		verified = true
		for _, id := range []string{"agent", "new"} {
			if _, err := s.runRollover(context.Background(), id, rolloverRequest{Reason: "long", Resume: true}, 0); !errors.Is(err, errRolloverConflict) {
				t.Fatal("busy session accepted a second rollover", id, err)
			}
		}
		return true, nil
	}
	h.capture = func(_ context.Context, row store.Session, n int) (string, error) {
		if n == scrollbackLines && row.ID == "agent" && s.rolloverStatus(row.ID).State == "ending" {
			return "fresh output before release", nil
		}
		return "saved before replacement", nil
	}
	h.prepareEnd = func(context.Context, store.Session) (func(context.Context) error, error) {
		if !handed || h.now().UnixMilli() != deadline {
			t.Fatal("end prepared before confirmed release")
		}
		end := h.end
		return func(ctx context.Context) error { return end(ctx, row) }, nil
	}
	h.wait = func(ctx context.Context, d time.Duration) error {
		if s.rolloverStatus(row.ID).State == "handed_off" {
			view := rolloverPairViews(t, s, rollover.HandedOff)
			if deadline == 0 {
				deadline = h.now().Add(10 * time.Minute).UnixMilli()
			}
			if view.EndsAt != deadline {
				t.Fatal("release deadline changed", view)
			}
			handed = true
			assertRolloverIntact(t, s, *steps)
		}
		return wait(ctx, d)
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual", Resume: true}, 0)
	if err != nil || !verified || !handed || result.State != "done" || !slices.Contains(*steps, "end") {
		t.Fatal(result, err, *steps)
	}
	sb, err := s.DB.GetScrollback(context.Background(), row.ID)
	if err != nil || string(sb.Content) != "fresh output before release" {
		t.Fatal("release did not save fresh scrollback", sb, err)
	}
	if s.RollingOver("agent") || s.RollingOver("new") {
		t.Fatal("completed pair remained busy")
	}
	if a := rolloverAudit(t, s, "handed_off"); a["newSessionId"] != "new" || len([]rune(a["summary"].(string))) != 200 {
		t.Fatal(a)
	}
	if a := rolloverAudit(t, s, "released"); a["sessionId"] != "agent" || a["newSessionId"] != "new" {
		t.Fatal(a)
	}
}

func TestRolloverNoAckKeepsOldSessionAndReportsFailure(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	base := homeFixture(t, s)
	var prompted time.Time
	send := h.send
	h.send = func(ctx context.Context, r store.Session, text string) error {
		if r.ID == "new" {
			prompted = h.now()
		}
		return send(ctx, r, text)
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "long", Resume: true}, 0)
	assertRolloverIntact(t, s, *steps)
	if err == nil || result.State != "failed" || h.now().Sub(prompted) != 10*time.Minute {
		t.Fatal(result, err, h.now().Sub(prompted))
	}
	rows, _ := s.DB.ListSessions(context.Background())
	view := s.autoRolloverSnapshot(rows)
	if view[row.ID].State != rollover.Failed || view[row.ID].NewSessionID != "new" || view["new"].State != "" {
		t.Fatal(view)
	}
	next, _ := s.DB.GetSession(context.Background(), "new")
	if next.Exited || s.RollingOver("agent") || s.RollingOver("new") {
		t.Fatal("failure altered replacement or left pair busy")
	}
	if a := rolloverAudit(t, s, "failed"); a["newSessionId"] != "new" || a["reason"] != err.Error() {
		t.Fatal(a)
	}
	files, readErr := os.ReadDir(filepath.Join(base, "agent-docs", "reports"))
	if readErr != nil || len(files) != 1 {
		t.Fatal(files, readErr)
	}
	data, _ := os.ReadFile(filepath.Join(base, "agent-docs", "reports", files[0].Name()))
	for _, want := range []string{"needs_user: true", "Session handover needs checking: A session", err.Error(), result.Handoff, "Old session: agent", "New session: new"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("report missing %q: %s", want, data)
		}
	}
}

func TestRolloverAckIsRequiredBeforeRelease(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	p := rollover.DefaultPolicy()
	p.KeepOldMinutes = 1
	s.autoRollover.policy = &p
	var prompted time.Time
	send, wait := h.send, h.wait
	h.send = func(ctx context.Context, r store.Session, text string) error {
		if r.ID == "new" {
			prompted = h.now()
		}
		return send(ctx, r, text)
	}
	h.wait = func(ctx context.Context, d time.Duration) error {
		if !prompted.IsZero() && h.now().Sub(prompted) < 2*time.Minute {
			assertRolloverIntact(t, s, *steps)
			if s.rolloverStatus(row.ID).State != "verifying" {
				t.Fatal("retention started without acknowledgement")
			}
			if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"release"}`, true); w.Code != 409 {
				t.Fatal("release accepted before acknowledgement", w.Code)
			}
		}
		if !prompted.IsZero() && h.now().Sub(prompted) == 2*time.Minute {
			if err := s.DB.SetSessionInfo(ctx, "new", nil, nil, []string{"handoff-ack"}); err != nil {
				t.Fatal(err)
			}
		}
		return wait(ctx, d)
	}
	end := h.end
	h.end = func(ctx context.Context, r store.Session) error {
		if h.now().Sub(prompted) < 3*time.Minute {
			t.Fatal("old session ended before acknowledgement plus retention")
		}
		return end(ctx, r)
	}
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "long", Resume: true}, 0); err != nil {
		t.Fatal(err)
	}
}

func TestRolloverScreenAckRequiresANewStandaloneMarker(t *testing.T) {
	for _, mode := range []string{"new", "stale", "echo"} {
		t.Run(mode, func(t *testing.T) {
			s, row, h, steps := rolloverFixture(t)
			prompted := false
			send := h.send
			h.send = func(ctx context.Context, r store.Session, text string) error {
				if r.ID == "new" {
					prompted = true
				}
				return send(ctx, r, text)
			}
			h.capture = func(_ context.Context, r store.Session, _ int) (string, error) {
				if r.ID != "new" {
					return "old screen", nil
				}
				if mode == "echo" {
					return handoffAckPrompt("/fixture") + "\nHANDOFF-ACK extra\n", nil
				}
				if mode == "stale" || prompted {
					return "\x1b[32m⏺ HANDOFF-ACK\x1b[0m\r\n", nil
				}
				return "", nil
			}
			result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "long", Resume: true}, 0)
			if mode == "new" {
				if err != nil || result.State != "done" {
					t.Fatal(result, err)
				}
			} else {
				if err == nil {
					t.Fatal("non-ack accepted")
				}
				assertRolloverIntact(t, s, *steps)
			}
		})
	}
}

func TestRolloverReplacementFailuresLeaveOldIntact(t *testing.T) {
	for _, mode := range []string{"create", "create-row", "ready", "ready-timeout", "exited", "vanished", "dead", "unreadable"} {
		t.Run(mode, func(t *testing.T) {
			s, row, h, steps := rolloverFixture(t)
			start := h.now()
			create := h.create
			switch mode {
			case "create":
				h.create = func(context.Context, store.Session) (store.Session, error) {
					return store.Session{}, errors.New("launch failed")
				}
			case "create-row":
				h.create = func(ctx context.Context, row store.Session) (store.Session, error) {
					next, _ := create(ctx, row)
					return next, errors.New("launch failed after row")
				}
			case "ready":
				h.ready = func(context.Context, store.Session) (bool, error) { return false, errors.New("not ready") }
			case "ready-timeout":
				h.ready = func(context.Context, store.Session) (bool, error) { return false, nil }
			case "dead":
				h.gone = func(_ context.Context, r store.Session) bool { return r.ID == "new" }
			case "exited", "vanished":
				send := h.send
				h.send = func(ctx context.Context, r store.Session, text string) error {
					if r.ID == "new" {
						if mode == "exited" {
							return s.DB.SetSessionExit(ctx, r.ID, true, 1)
						}
						_, err := s.DB.SQL().Exec(`DELETE FROM sessions WHERE id = ?`, r.ID)
						return err
					}
					return send(ctx, r, text)
				}
			case "unreadable":
				h.send = func(context.Context, store.Session, string) error {
					return os.Mkdir(rolloverDraftPath(row.CWD, "", row.ID), 0700)
				}
			}
			result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "long", Resume: true}, 0)
			assertRolloverIntact(t, s, *steps)
			if err == nil || result.State != "failed" || h.now().Sub(start) >= rolloverAckTimeout {
				t.Fatal("failure was not immediate", result, err, h.now().Sub(start))
			}
			rolloverAudit(t, s, "failed")
		})
	}
}

func TestRolloverInputKeepsOldSession(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	ackRolloverByLabel(t, s, h)
	s.autoRollover.now = h.now
	wait := h.wait
	typed := false
	h.wait = func(ctx context.Context, d time.Duration) error {
		err := wait(ctx, d)
		if s.rolloverStatus(row.ID).State == "handed_off" && !typed {
			typed = true
			s.noteResourceInput(row.ID)
		}
		return err
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "long", Resume: true}, 0)
	assertRolloverIntact(t, s, *steps)
	if err != nil || !typed || result.State != "idle" || s.RollingOver("new") {
		t.Fatal(result, err, typed)
	}
	if a := rolloverAudit(t, s, "cancelled"); a["reason"] != "input" {
		t.Fatal(a)
	}
	rows, _ := s.DB.ListSessions(context.Background())
	if views := s.autoRolloverSnapshot(rows); len(views) != 0 {
		t.Fatal("kept sessions are not ordinary", views)
	}
}

func TestRolloverPairActionsAndGuards(t *testing.T) {
	for _, mode := range []string{"keep-verifying", "keep-handed_off", "release"} {
		t.Run(mode, func(t *testing.T) {
			s, row, h, steps := rolloverFixture(t)
			if mode != "keep-verifying" {
				ackRolloverByLabel(t, s, h)
			}
			wait := h.wait
			acted := false
			h.wait = func(ctx context.Context, d time.Duration) error {
				state := s.rolloverStatus(row.ID).State
				if !acted && (mode == "keep-verifying" && state == "verifying" || mode != "keep-verifying" && state == "handed_off") {
					acted = true
					action := "keep"
					if mode == "release" {
						action = "release"
					}
					for _, bad := range []string{"now", "later", "never", "cancel"} {
						if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"`+bad+`"}`, true); w.Code != 409 {
							t.Fatal(bad, w.Code)
						}
					}
					for _, id := range []string{"agent", "new"} {
						for _, authenticated := range []bool{false, true} {
							want := 401
							if authenticated {
								want = 409
								if id == "agent" {
									want = 204
								}
							}
							w := homeRequest(t, s, "POST", "/api/sessions/"+id+"/rollover/auto", `{"action":"`+action+`"}`, authenticated)
							if w.Code != want {
								t.Fatal(id, action, w.Code, w.Body.String())
							}
						}
					}
				}
				return wait(ctx, d)
			}
			result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "long", Resume: true}, 0)
			if err != nil || !acted {
				t.Fatal(result, err)
			}
			if mode == "release" {
				if !slices.Contains(*steps, "end") {
					t.Fatal("release did not end old session")
				}
				rolloverAudit(t, s, "released")
			} else {
				assertRolloverIntact(t, s, *steps)
				if a := rolloverAudit(t, s, "cancelled"); a["reason"] != "keep" {
					t.Fatal(a)
				}
			}
			for _, action := range []string{"keep", "release"} {
				if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"`+action+`"}`, true); w.Code != 409 {
					t.Fatal(action, w.Code)
				}
			}
		})
	}
}

func TestRolloverSectionsRepairOnceAndPreserveAgentText(t *testing.T) {
	complete := "# 目标\n任务\n## 已完成\n完成\n## 未完成\n待办\n## 下一步\n继续\n## 验证命令\ngo test\n## 禁止事项\n不要部署\n"
	for _, mode := range []string{"complete", "repair", "appendix"} {
		t.Run(mode, func(t *testing.T) {
			s, row, h, _ := rolloverFixture(t)
			asked := 0
			original := "# 目标\n" + strings.Repeat("agent words\n", 20)
			h.send = func(ctx context.Context, r store.Session, text string) error {
				if r.ID == "new" {
					return s.DB.SetSessionInfo(ctx, r.ID, nil, nil, []string{"handoff-ack"})
				}
				asked++
				if asked > 2 {
					t.Fatal("asked more than once to repair")
				}
				if asked == 2 {
					for _, name := range []string{"已完成", "未完成", "下一步", "验证命令", "禁止事项"} {
						if !strings.Contains(text, name) {
							t.Fatal("missing name in repair", text)
						}
					}
				}
				data := original
				if mode == "complete" || mode == "repair" && asked == 2 {
					data += complete
				}
				return os.WriteFile(rolloverDraftPath(row.CWD, "", row.ID), []byte(data), 0600)
			}
			result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual", Resume: true}, 0)
			if err != nil {
				t.Fatal(err)
			}
			data, _ := os.ReadFile(result.Handoff)
			if !strings.HasPrefix(string(data), original) {
				t.Fatal("agent text overwritten", string(data))
			}
			want := 2
			if mode == "complete" {
				want = 1
			}
			if asked != want || strings.Contains(string(data), "## Pantheon fallback") != (mode == "appendix") {
				t.Fatal(asked, string(data))
			}
			if mode == "appendix" {
				for _, name := range []string{"Missing sections: 已完成、未完成、下一步、验证命令、禁止事项", "last output (200)", "git status --short", "git log --oneline -5"} {
					if !strings.Contains(string(data), name) {
						t.Fatal(name, string(data))
					}
				}
			}
		})
	}
}

func TestRolloverMemoryResumeStillEndsFirst(t *testing.T) {
	s, row, _, steps := rolloverFixture(t)
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "memory", Resume: true}, 0)
	if err != nil || len(*steps) != 5 || (*steps)[1] != "end" || (*steps)[2] != "create:codex:profile" || (*steps)[4] != "send:new:请先阅读交接文档 "+result.Handoff+"，确认理解后从“下一步”继续。" {
		t.Fatal(result, err, *steps)
	}
}

func TestMeAcceptsHandoffAckLabelThroughSessionDoor(t *testing.T) {
	s, row, _, _ := rolloverFixture(t)
	root, err := s.HookToken(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("PATCH", "/api/me/v1", strings.NewReader(`{"labels":["handoff-ack"],"summary":"Continue the next step"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+hooks.ReportToken(root, row.ID))
	r.Header.Set("X-Vibepanel-Session", row.ID)
	w := httptest.NewRecorder()
	s.Routes().ServeHTTP(w, r)
	fresh, _ := s.DB.GetSession(context.Background(), row.ID)
	if w.Code != 200 || !slices.Equal(fresh.Labels, []string{"handoff-ack"}) || fresh.Summary != "Continue the next step" {
		t.Fatal(w.Code, w.Body.String(), fresh)
	}
}

func TestRolloverMemoryAlertReleasesConfirmedPairImmediately(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	ackRolloverByLabel(t, s, h)
	var ackAt time.Time
	send := h.send
	h.send = func(ctx context.Context, row store.Session, text string) error {
		if row.ID == "new" {
			ackAt = h.now()
		}
		return send(ctx, row, text)
	}
	h.alert = func() bool { return true }
	end := h.end
	h.end = func(ctx context.Context, row store.Session) error {
		if ackAt.IsZero() || !h.now().Equal(ackAt) {
			t.Fatal("memory release did not follow ack immediately", h.now(), ackAt)
		}
		return end(ctx, row)
	}
	if _, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual", Resume: true}, 0); err != nil || !slices.Contains(*steps, "end") {
		t.Fatal(err, *steps)
	}
	rolloverAudit(t, s, "handed_off")
	rolloverAudit(t, s, "released")
}

func TestAutoRolloverFailedVerifyCountsAttemptAndReportsOnce(t *testing.T) {
	s, row, _, steps := rolloverFixture(t)
	at := time.Now()
	s.autoRollover.entries = map[string]rollover.Memory{row.ID: {View: rollover.View{State: rollover.HandingOff}, Attempts: []time.Time{at}}}
	s.executeAutoRollover(row.ID)
	assertRolloverIntact(t, s, *steps)
	for _, id := range []string{row.ID, "new"} {
		if got := s.autoRollover.entries[id].Attempts; len(got) != 1 || got[0] != at {
			t.Fatal("failed verification lost the attempt", id, got)
		}
	}
	if m := s.autoRollover.entries[row.ID]; m.State != rollover.Failed || m.NewSessionID != "new" {
		t.Fatal(m)
	}
	rolloverAudit(t, s, "failed")
}

func TestRolloverReplacementExitAfterAckAlsoKeepsOldSession(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	ackRolloverByLabel(t, s, h)
	wait := h.wait
	h.wait = func(ctx context.Context, d time.Duration) error {
		if s.rolloverStatus(row.ID).State == "handed_off" {
			if err := s.DB.SetSessionExit(ctx, "new", true, 1); err != nil {
				t.Fatal(err)
			}
		}
		return wait(ctx, d)
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual", Resume: true}, 0)
	assertRolloverIntact(t, s, *steps)
	if err == nil || result.State != "failed" {
		t.Fatal(result, err)
	}
	rolloverAudit(t, s, "failed")
}

// A capture that times out on a loaded machine is not the replacement going
// away. It used to fail the whole handoff on the first miss; the label still
// confirms, and with neither the ten-minute deadline is what fails it.
func TestRolloverUnreadableReplacementScreenStillTakesTheLabel(t *testing.T) {
	for _, labelled := range []bool{true, false} {
		s, row, h, steps := rolloverFixture(t)
		if labelled {
			ackRolloverByLabel(t, s, h)
		}
		capture := h.capture
		h.capture = func(ctx context.Context, r store.Session, n int) (string, error) {
			if r.ID == "new" {
				return "", errors.New("capture timed out")
			}
			return capture(ctx, r, n)
		}
		result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual", Resume: true}, 0)
		if labelled {
			if err != nil || result.State != "done" || !slices.Contains(*steps, "end") {
				t.Fatal("labelled", result, err, *steps)
			}
			continue
		}
		assertRolloverIntact(t, s, *steps)
		if err == nil || !strings.Contains(result.Error, "within 10 minutes") {
			t.Fatal("unlabelled", result, err)
		}
	}
}

func TestRolloverInputBeforeTheAckKeepsOldSession(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	s.autoRollover.now = h.now
	send := h.send
	h.send = func(ctx context.Context, r store.Session, text string) error {
		if err := send(ctx, r, text); err != nil {
			return err
		}
		if r.ID == "new" {
			// The person asks the old agent for one more thing while the new
			// one is still reading; the ack follows a moment later.
			if err := h.wait(ctx, time.Second); err != nil {
				return err
			}
			s.noteResourceInput(row.ID)
			summary := "下一步"
			return s.DB.SetSessionInfo(ctx, r.ID, &summary, nil, []string{"handoff-ack"})
		}
		return nil
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "long", Resume: true}, 0)
	assertRolloverIntact(t, s, *steps)
	if err != nil || result.State != "idle" {
		t.Fatal(result, err)
	}
	if a := rolloverAudit(t, s, "cancelled"); a["reason"] != "input" {
		t.Fatal(a)
	}
}

func waitRolloverState(t *testing.T, s *Server, id, want string) rolloverStatus {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		status := s.rolloverStatus(id)
		if status.State == want {
			return status
		}
		if time.Now().After(deadline) {
			t.Fatalf("rollover state %q, want %q", status.State, want)
		}
		time.Sleep(time.Millisecond)
	}
}

// The menu's request answered only when the old session was released, twenty
// minutes after it was sent with the defaults.
func TestRolloverRequestAnswersOnceTheReplacementExists(t *testing.T) {
	s, row, h, _ := rolloverFixture(t)
	proceed := make(chan struct{})
	wait := h.wait
	h.wait = func(ctx context.Context, d time.Duration) error {
		if s.rolloverStatus(row.ID).State == "verifying" {
			<-proceed
		}
		return wait(ctx, d)
	}
	answered := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		answered <- homeRequest(t, s, "POST", "/api/sessions/agent/rollover", `{"reason":"manual","resume":true}`, true)
	}()
	var w *httptest.ResponseRecorder
	select {
	case w = <-answered:
	case <-time.After(5 * time.Second):
		close(proceed)
		t.Fatal("the request waited for the confirmation")
	}
	result := homeDecode[rolloverStatus](t, w, 200)
	if result.NewSessionID != "new" || s.rolloverStatus(row.ID).State != "verifying" {
		t.Fatal(result, s.rolloverStatus(row.ID))
	}
	summary := "下一步"
	if err := s.DB.SetSessionInfo(context.Background(), "new", &summary, nil, []string{"handoff-ack"}); err != nil {
		t.Fatal(err)
	}
	close(proceed)
	waitRolloverState(t, s, row.ID, "done")
}

func TestRolloverPairActionsKeepDevelopmentAllowList(t *testing.T) {
	s, _, _, _ := rolloverFixture(t)
	s.rollovers.states = map[string]rolloverStatus{"agent": {State: "handed_off", NewSessionID: "new"}}
	for _, action := range []string{"keep", "release"} {
		s.Cfg.Development = true
		s.Cfg.DevelopmentTerminal = false
		if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"`+action+`"}`, true); w.Code != 403 {
			t.Fatal(action, w.Code)
		}
		s.Cfg.DevelopmentTerminal = true
		if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"`+action+`"}`, true); w.Code != 204 {
			t.Fatal(action, w.Code)
		}
	}
}

func TestRolloverInputDuringTheFinalCheckKeepsOldSession(t *testing.T) {
	s, row, h, steps := rolloverFixture(t)
	ackRolloverByLabel(t, s, h)
	s.autoRollover.now = h.now
	// The liveness read is the last thing between the check and the release.
	h.gone = func(ctx context.Context, r store.Session) bool {
		if r.ID == "new" && s.rolloverStatus(row.ID).State == "handed_off" {
			if err := h.wait(ctx, time.Second); err != nil {
				t.Fatal(err)
			}
			s.noteResourceInput(row.ID)
			if !s.rolloverPairAction(row.ID, "release") {
				t.Fatal("release was not available")
			}
		}
		return false
	}
	result, err := s.runRollover(context.Background(), row.ID, rolloverRequest{Reason: "manual", Resume: true}, 0)
	assertRolloverIntact(t, s, *steps)
	if err != nil || result.State != "idle" {
		t.Fatal(result, err)
	}
	if a := rolloverAudit(t, s, "cancelled"); a["reason"] != "input" {
		t.Fatal(a)
	}
}
