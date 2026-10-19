package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/agentctx"
	"github.com/jiangmuran/vibepanel/internal/hooks"
	"github.com/jiangmuran/vibepanel/internal/rollover"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

func autoFixture(t *testing.T) (*Server, store.Session, *time.Time) {
	t.Helper()
	s, row, _, _ := rolloverFixture(t)
	t.Cleanup(s.autoRollover.audits.Wait)
	s.Manager = session.NewManager(nil, 256<<10)
	s.hookCheckedAt = time.Now().Add(time.Hour)
	now := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	s.autoRollover.now = func() time.Time { return now }
	s.contexts.publish(row.ID, agentctx.Usage{Used: 72_000, Window: 100_000, Source: agentctx.Codex, At: now}, true)
	row.StateSource = session.SourceHook
	return s, row, &now
}

func autoTick(t *testing.T, s *Server, row store.Session) {
	t.Helper()
	if err := s.refreshAutoRollovers(context.Background(), []store.Session{row}, map[string]tmux.Info{row.TmuxName: {PID: 20, Command: "codex"}}); err != nil {
		t.Fatal(err)
	}
}

func TestAutoRolloverPolicyReadWriteValidationAndCache(t *testing.T) {
	s, _, _ := autoFixture(t)
	p := homeDecode[rollover.Policy](t, homeRequest(t, s, "GET", "/api/settings/rollover", "", true), 200)
	if p != rollover.DefaultPolicy() {
		t.Fatal(p)
	}
	for _, body := range []string{
		`{"thresholdPct":29}`, `{"thresholdPct":96}`, `{"countdownSeconds":4}`, `{"countdownSeconds":301}`,
		`{"keepOldMinutes":0}`, `{"keepOldMinutes":121}`, `{"idleInputSeconds":9}`, `{"idleInputSeconds":1801}`,
		`{"enabled":"yes"}`, `{"thresholdPct":70.5}`, `{"extra":1}`, `{"enabled":null}`, `{"thresholdPct":null}`, `null`,
	} {
		if w := homeRequest(t, s, "PUT", "/api/settings/rollover", body, true); w.Code != 400 {
			t.Fatalf("%s: %d %s", body, w.Code, w.Body.String())
		}
	}
	got := homeDecode[rollover.Policy](t, homeRequest(t, s, "PUT", "/api/settings/rollover", `{"enabled":false,"thresholdPct":30,"countdownSeconds":5,"keepOldMinutes":120,"idleInputSeconds":10}`, true), 200)
	if got.Enabled || got.ThresholdPct != 30 || got.KeepOldMinutes != 120 {
		t.Fatal(got)
	}
	for key, want := range map[string]string{"enabled": "false", "thresholdPct": "30", "countdownSeconds": "5", "keepOldMinutes": "120", "idleInputSeconds": "10"} {
		if raw, err := s.DB.GetSetting(context.Background(), "rollover.auto."+key, ""); err != nil || raw != want {
			t.Fatalf("%s=%s, %v", key, raw, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if cached, _, err := s.loadAutoSettings(ctx); err != nil || cached != got {
		t.Fatal("successful read was not cached", cached, err)
	}
}

func TestAutoRolloverPolicyFailedReadIsNotDefault(t *testing.T) {
	s, _, _ := autoFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := s.loadAutoSettings(ctx); err == nil || s.autoRollover.policy != nil {
		t.Fatal("failed read cached a default")
	}
	if err := s.DB.SetSetting(context.Background(), "rollover.auto.enabled", "false"); err != nil {
		t.Fatal(err)
	}
	p, _, err := s.loadAutoSettings(context.Background())
	if err != nil || p.Enabled {
		t.Fatal("failed read masked disabled policy", p, err)
	}
	s.autoRollover.policy = nil
	if err := s.DB.SetSetting(context.Background(), "rollover.auto.thresholdPct", "garbage"); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"GET", "PUT"} {
		if w := homeRequest(t, s, method, "/api/settings/rollover", `{}`, true); w.Code != 503 {
			t.Fatalf("corrupt policy %s: %d", method, w.Code)
		}
	}
	if s.autoRollover.policy != nil {
		t.Fatal("corrupt policy was cached")
	}
	if err := s.DB.SetSettings(context.Background(), map[string]string{"rollover.auto.thresholdPct": "70", "rollover.auto.enabled": " null "}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.loadAutoSettings(context.Background()); err == nil {
		t.Fatal("stored null enabled the default policy")
	}
	if err := s.DB.SetSetting(context.Background(), "rollover.auto.enabled", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.loadAutoSettings(context.Background()); err == nil {
		t.Fatal("stored empty value enabled the default policy")
	}
	if err := s.DB.SetSettings(context.Background(), map[string]string{"rollover.auto.enabled": "true", autoNeverKey: `{"agent":null}`}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.loadAutoSettings(context.Background()); err == nil {
		t.Fatal("corrupt off switch enabled a session")
	}
}

func TestAutoRolloverRoutesAuthenticationAndDevelopment(t *testing.T) {
	s, _, _ := autoFixture(t)
	for _, route := range []struct{ method, path, body string }{
		{"POST", "/api/sessions/agent/rollover/auto", `{"action":"later"}`},
		{"GET", "/api/settings/rollover", ""},
		{"PUT", "/api/settings/rollover", `{}`},
	} {
		if w := homeRequest(t, s, route.method, route.path, route.body, false); w.Code != 401 {
			t.Fatal("anonymous route", w.Code)
		}
		s.Cfg.Development = true
		s.Cfg.DevelopmentTerminal = false
		if w := homeRequest(t, s, route.method, route.path, route.body, true); w.Code != 403 {
			t.Fatal("planning route", w.Code)
		}
		s.Cfg.DevelopmentTerminal = true
		if w := homeRequest(t, s, route.method, route.path, route.body, true); w.Code >= 400 {
			t.Fatal("development terminal route", w.Code, w.Body.String())
		}
		s.Cfg.Development = false
	}
	for _, method := range []string{"GET", "PUT", "PATCH", "DELETE"} {
		if developmentTerminalRoute(method, "/api/sessions/agent/rollover/auto") {
			t.Fatal("extra method allowed", method)
		}
	}
	for _, path := range []string{"/api/sessions/agent/rollover/auto/extra", "/api/sessions/agent/rollover/other", "/api/sessions//rollover/auto"} {
		if developmentTerminalRoute("POST", path) {
			t.Fatal("extra path allowed", path)
		}
	}
}

func TestAutoRolloverActionsAndPersistentNever(t *testing.T) {
	s, row, now := autoFixture(t)
	for _, tc := range []struct {
		path, body string
		want       int
	}{
		{"agent", `{"action":"invalid"}`, 400}, {"agent", `{"action":"now","unknown":true}`, 400},
		{"missing", `{"action":"later"}`, 404}, {"agent", `{"action":"now"}`, 204},
	} {
		w := homeRequest(t, s, "POST", "/api/sessions/"+tc.path+"/rollover/auto", tc.body, true)
		if w.Code != tc.want {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body.String())
		}
	}
	if s.autoRollover.entries[row.ID].State != rollover.Due {
		t.Fatal("now did not mark due")
	}
	for _, action := range []string{"later", "cancel", "never"} {
		s.autoRollover.entries[row.ID] = rollover.Memory{View: rollover.View{State: rollover.Countdown, EndsAt: now.Add(time.Minute).UnixMilli(), Pct: 72}}
		if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"`+action+`"}`, true); w.Code != 204 {
			t.Fatal(w.Code)
		}
		if m := s.autoRollover.entries[row.ID]; m.State != rollover.OK || !m.Postponed {
			t.Fatal(action, m)
		}
	}
	s.autoRollover.policy = nil
	_, never, err := s.loadAutoSettings(context.Background())
	if err != nil || !never[row.ID] {
		t.Fatal("never did not survive cache reset", never, err)
	}
	// "Never" holds back the automatic trigger. A person pressing the button
	// is not that, and the request must stand on the next poll too.
	if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"now"}`, true); w.Code != 204 {
		t.Fatal("never refused an explicit request", w.Code)
	}
	if s.autoRollover.entries[row.ID].State != rollover.Due {
		t.Fatal("an explicit request under never did not mark due")
	}
	if err := s.DB.DeleteSession(context.Background(), row.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.pruneAutoNever(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	raw, _ := s.DB.GetSetting(context.Background(), autoNeverKey, "")
	if raw != "{}" {
		t.Fatal("deleted session left preference behind", raw)
	}
}

func TestAutoRolloverSnapshotDoesNotStormAndInputCancels(t *testing.T) {
	s, row, now := autoFixture(t)
	ctx := context.Background()
	autoTick(t, s, row)
	if s.changedSnapshot(ctx) == nil {
		t.Fatal("no initial snapshot")
	}
	*now = now.Add(15 * time.Second)
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.Due || s.changedSnapshot(ctx) == nil {
		t.Fatal("due was not published")
	}
	for range 5 {
		*now = now.Add(time.Second)
		autoTick(t, s, row)
		if s.changedSnapshot(ctx) != nil {
			t.Fatal("due churned")
		}
	}
	*now = now.Add(2 * time.Minute)
	autoTick(t, s, row)
	first := s.autoRolloverSnapshot([]store.Session{row})[row.ID]
	if first.State != rollover.Countdown || s.changedSnapshot(ctx) == nil {
		t.Fatal("countdown was not published", first)
	}
	for range 5 {
		*now = now.Add(time.Second)
		autoTick(t, s, row)
		if got := s.autoRolloverSnapshot([]store.Session{row})[row.ID]; got != first || s.changedSnapshot(ctx) != nil {
			t.Fatal("countdown churned", got)
		}
	}
	s.noteResourceInput(row.ID)
	if s.lastResourceInput(row.ID) != *now || len(s.autoRolloverSnapshot([]store.Session{row})) != 0 || s.changedSnapshot(ctx) == nil {
		t.Fatal("keystroke failed to cancel immediately")
	}
	if s.changedSnapshot(ctx) != nil {
		t.Fatal("cancel churned")
	}
	if !s.autoRollover.entries[row.ID].Postponed {
		t.Fatal("cancel did not postpone")
	}
}

func TestAutoRolloverDraftsAndBackgroundBoundary(t *testing.T) {
	s, row, now := autoFixture(t)
	s.autoRollover.entries = map[string]rollover.Memory{row.ID: {View: rollover.View{State: rollover.Due}, SeenAt: now.Add(-time.Hour)}}
	s.noteAutoDraft(context.Background(), "tab-one", row.ID, true)
	s.noteAutoDraft(context.Background(), "tab-two", row.ID, true)
	s.noteAutoDraft(context.Background(), "tab-one", row.ID, false)
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.Due {
		t.Fatal("one tab cleared another tab's draft")
	}
	s.forgetAutoDrafts("tab-two")
	s.noteAutoBackground(row.ID, true)
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.Due {
		t.Fatal("known background task was ignored")
	}
	s.noteAutoBackground(row.ID, false)
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.Countdown {
		t.Fatal("cleared draft and background still blocked")
	}
	s.noteAutoDraft(context.Background(), "tab-new", row.ID, true)
	*now = now.Add(31 * time.Second)
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.Due {
		t.Fatal("draft during countdown did not hold handoff")
	}
	s.noteAutoDraft(context.Background(), "tab-new", "unknown", true)
	if s.autoRollover.drafts["tab-new"]["unknown"] {
		t.Fatal("unknown session accepted draft")
	}
}

func TestAutoRolloverUsesLiveDetectorAndExcludesHiddenProjects(t *testing.T) {
	s, row, now := autoFixture(t)
	s.Detector = session.NewDetector()
	s.Detector.Hook(row.ID, session.HookReport{State: session.StateWorking}, *now)
	s.autoRollover.entries = map[string]rollover.Memory{row.ID: {View: rollover.View{State: rollover.Due}, SeenAt: now.Add(-time.Hour)}}
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.Due {
		t.Fatal("stale done row overrode a working detector")
	}
	s.Detector.Hook(row.ID, session.HookReport{State: session.StateWaiting}, now.Add(time.Second))
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.Due {
		t.Fatal("permission prompt became a boundary")
	}
	if err := s.DB.ArchiveProject(context.Background(), row.ProjectID, false); err != nil {
		t.Fatal(err)
	}
	autoTick(t, s, row)
	if s.autoRollover.entries[row.ID].State != rollover.OK {
		t.Fatal("hidden project's session remained due")
	}
}

func TestAutoRolloverExecutionReusesLongResumePrimitive(t *testing.T) {
	s, row, _, steps := rolloverFixture(t)
	s.autoRollover.entries = map[string]rollover.Memory{row.ID: {View: rollover.View{State: rollover.HandingOff, Pct: 72}, Attempts: []time.Time{time.Now()}}}
	s.executeAutoRollover(row.ID)
	status := s.rolloverStatus(row.ID)
	if status.State != "done" || status.NewSessionID != "new" {
		t.Fatal(status)
	}
	if got := strings.Join(*steps, "\n"); !strings.Contains(got, "end\ncreate:codex:profile") || !strings.Contains(got, "请先阅读交接文档") {
		t.Fatal(got)
	}
	if s.autoRollover.entries["new"].Attempts == nil {
		t.Fatal("replacement reset the cap")
	}
	s.autoRollover.run = func(context.Context, string) (rolloverStatus, error) {
		return rolloverStatus{}, errors.New("fixture failure")
	}
	s.executeAutoRollover(row.ID)
	if s.autoRollover.entries[row.ID].State != rollover.Failed {
		t.Fatal("failure was not visible")
	}
}

func TestAutoRolloverPreCompactIsAuthenticatedAndStateNeutral(t *testing.T) {
	s, row, now := autoFixture(t)
	// A panel-started Claude with low known usage. The stored state is left
	// working so this also asserts that the hook cannot create a boundary.
	row, err := s.DB.CreateSession(context.Background(), store.Session{ID: "claude", ProjectID: row.ProjectID, TmuxName: "vp_claude", LaunchCommand: []string{"claude"}, State: session.StateWorking})
	if err != nil {
		t.Fatal(err)
	}
	s.contexts.publish(row.ID, agentctx.Usage{Used: 10_000, Window: 100_000, Source: agentctx.Claude, At: *now}, true)
	s.Detector = session.NewDetector()
	root, err := s.HookToken(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	send := func(signal, state, source, token, body string) int {
		r := httptest.NewRequest("POST", "/api/hook/state?sessionId=claude&signal="+signal+"&state="+state+"&source="+source, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.handleHookState(w, r)
		return w.Code
	}
	doc := `{"hook_event_name":"PreCompact","trigger":"auto","future_field":true}`
	for _, tc := range []struct {
		signal, state, source, token, body string
		want                               int
	}{
		{hooks.SignalPreCompact, "", "", "wrong", doc, 401},
		{"unknown", "", "", root, doc, 400},
		{hooks.SignalPreCompact, "done", "", root, doc, 400},
		{hooks.SignalPreCompact, "", "codex", root, doc, 400},
		{hooks.SignalPreCompact, "", "", root, `{}`, 204},
		{hooks.SignalPreCompact, "", "", root, `{"hook_event_name":"PreCompact"}`, 204},
	} {
		if code := send(tc.signal, tc.state, tc.source, tc.token, tc.body); code != tc.want {
			t.Fatalf("%+v: %d", tc, code)
		}
		if len(s.autoRollover.entries) != 0 {
			t.Fatal("bad/absent trigger marked due")
		}
	}
	if code := send(hooks.SignalPreCompact, "", "", hooks.ReportToken(root, row.ID), doc); code != 204 {
		t.Fatal(code)
	}
	if got := s.autoRollover.entries[row.ID]; got.State != rollover.Due || got.Reason != "precompact" {
		t.Fatal(got)
	}
	current, _ := s.DB.GetSession(context.Background(), row.ID)
	if !reflect.DeepEqual(current, row) || !s.Detector.LastHook(row.ID).IsZero() {
		t.Fatal("PreCompact altered displayed state or detector")
	}
	view := s.autoRollover.entries[row.ID].View
	_ = send(hooks.SignalPreCompact, "", "", root, doc)
	if s.autoRollover.entries[row.ID].View != view {
		t.Fatal("repeated hook advanced state")
	}
	data, _ := json.Marshal(s.autoRolloverSnapshot([]store.Session{row}))
	if !strings.Contains(string(data), `"state":"due"`) {
		t.Fatal(string(data))
	}
}

func TestAutoRolloverNewSettingsWinOverAnOldObservation(t *testing.T) {
	s, row, now := autoFixture(t)
	p, _, err := s.loadAutoSettings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	o := s.autoObservation(row, false)
	setCountdown := func() {
		s.autoRollover.entries = map[string]rollover.Memory{row.ID: {
			View:   rollover.View{State: rollover.Countdown, Pct: 72, EndsAt: now.UnixMilli()},
			SeenAt: now.Add(-time.Hour), CountdownAt: now.Add(-time.Minute),
		}}
	}
	setCountdown()
	if err := s.setAutoNever(context.Background(), row.ID); err != nil {
		t.Fatal(err)
	}
	if result := s.stepAutoRollover(row.ID, o, p); result.Start || result.Memory.State != rollover.OK {
		t.Fatal("stale never preference started a handoff", result)
	}
	s.autoRollover.never = map[string]bool{}
	setCountdown()
	if w := homeRequest(t, s, "PUT", "/api/settings/rollover", `{"enabled":false}`, true); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if result := s.stepAutoRollover(row.ID, o, p); result.Start || result.Memory.State != rollover.OK || result.Memory.Postponed {
		t.Fatal("stale enabled policy started a handoff or raised the threshold", result)
	}
}

func TestAutoRolloverCountdownDispatchesOnceAndAuditsFailure(t *testing.T) {
	s, row, now := autoFixture(t)
	started, release, finished := make(chan struct{}, 2), make(chan struct{}), make(chan struct{})
	s.autoRollover.run = func(context.Context, string) (rolloverStatus, error) {
		started <- struct{}{}
		<-release
		return rolloverStatus{}, errors.New("fixture handoff failed")
	}
	s.autoRollover.entries = map[string]rollover.Memory{row.ID: {
		View:   rollover.View{State: rollover.Countdown, Pct: 72, EndsAt: now.UnixMilli()},
		SeenAt: now.Add(-time.Hour), CountdownAt: now.Add(-time.Minute),
	}}
	autoTick(t, s, row)
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("countdown never dispatched")
	}
	autoTick(t, s, row)
	select {
	case <-started:
		t.Fatal("handoff dispatched twice")
	default:
	}
	if w := homeRequest(t, s, "POST", "/api/sessions/agent/rollover/auto", `{"action":"cancel"}`, true); w.Code != 409 {
		t.Fatal("cancellation claimed to undo an active handoff", w.Code)
	}
	close(release)
	go func() {
		defer close(finished)
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			entries, _ := s.DB.RecentAuditPrefix(context.Background(), "rollover.failed", 10)
			if len(entries) == 1 {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	<-finished
	entries, err := s.DB.RecentAuditPrefix(context.Background(), "rollover.failed", 10)
	if err != nil || len(entries) != 1 {
		t.Fatal("failure event missing", entries, err)
	}
	var detail struct {
		SessionID string `json:"sessionId"`
		Pct       int    `json:"pct"`
		Reason    string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(entries[0].Detail), &detail); err != nil || detail.SessionID != row.ID || detail.Pct != 72 || detail.Reason != "fixture handoff failed" {
		t.Fatal(detail, err)
	}
}

func TestAutoRolloverLogOnlyDoneNeedsTwoMinutesOfQuiet(t *testing.T) {
	s, row, now := autoFixture(t)
	row.StateChangedAt = now.Add(-time.Hour).Unix()
	s.Detector = session.NewDetector()
	s.Detector.ReportLog(row.ID, session.StateDone, now.Add(-time.Minute))
	s.Detector.Observe(row.ID, session.Signals{Visible: true}, *now)
	s.autoRollover.entries = map[string]rollover.Memory{row.ID: {View: rollover.View{State: rollover.Due}, SeenAt: now.Add(-time.Hour)}}
	autoTick(t, s, row)
	if s.autoRolloverSnapshot([]store.Session{row})[row.ID].State != rollover.Due {
		t.Fatal("log source was mistaken for a received hook")
	}
	*now = now.Add(2 * time.Minute)
	autoTick(t, s, row)
	if s.autoRolloverSnapshot([]store.Session{row})[row.ID].State != rollover.Countdown {
		t.Fatal("quiet log-backed done did not reach boundary")
	}
}
