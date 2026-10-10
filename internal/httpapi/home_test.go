package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/auth"
	"github.com/jiangmuran/vibepanel/internal/config"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
)

type testServerMode bool

const inProcessTestServer testServerMode = true

// The home tests exercise the real router and cookie lookup, but need neither
// a listener nor a tmux server on a host shared with a live panel.
func newInProcessTestServer(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(context.Background(), filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	cfg := config.Default()
	cfg.DataDir = dir
	cfg.StaticDir = dir
	cfg.Addr = "127.0.0.1:29876"
	cfg.CyxHome = filepath.Join(dir, "cyx")
	s := &Server{Cfg: cfg, DB: db, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Auth: &Auth{Throttle: auth.NewThrottle()}}
	if _, err = db.CreateUser(context.Background(), "home-test", "tester", "unused"); err != nil {
		t.Fatal(err)
	}
	if err = db.CreateAuthSession(context.Background(), auth.HashToken("home-cookie"), "home-test", time.Hour, "test", "127.0.0.1", "http://panel.test"); err != nil {
		t.Fatal(err)
	}
	return s
}

func homeRequest(t *testing.T, s *Server, method, path, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://panel.test"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if authenticated {
		r.AddCookie(&http.Cookie{Name: auth.CookieNameAt(auth.CookieName, s.Cfg.BasePath), Value: "home-cookie"})
	}
	w := httptest.NewRecorder()
	s.Routes().ServeHTTP(w, r)
	return w
}

func homePut(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), 0644); err != nil {
		t.Fatal(err)
	}
}

func homeFixture(t *testing.T, s *Server) string {
	t.Helper()
	harness := filepath.Join(s.Cfg.DataDir, "harness")
	project := filepath.Join(harness, "projects/demo")
	homePut(t, filepath.Join(project, "project.json"), `{"id":"demo","status":"active","aliases":[]}`)
	homePut(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Goal**: Ship home\n")
	local, _ := json.Marshal(map[string]any{"version": 1, "paths": map[string]string{"cyx-agent-harness": harness, "demo": s.Cfg.DataDir}})
	homePut(t, filepath.Join(s.Cfg.CyxHome, "local.json"), string(local))
	return project
}

func homeDecode[T any](t *testing.T, w *httptest.ResponseRecorder, status int) T {
	t.Helper()
	if w.Code != status {
		t.Fatalf("HTTP %d, want %d: %s", w.Code, status, w.Body.String())
	}
	var out T
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestHomeAPIUnavailableAndAuthentication(t *testing.T) {
	_, s := newTestServer(t, inProcessTestServer)
	s.Cfg.Development = true
	for _, request := range []struct{ method, path string }{{"GET", "/api/home"}, {"GET", "/api/home/projects/demo"}, {"POST", "/api/home/projects/demo/tasks"}, {"PATCH", "/api/home/projects/demo/tasks/A2"}, {"POST", "/api/home/projects/demo/sessions"}, {"GET", "/api/home/projects/demo/discussion"}, {"POST", "/api/home/projects/demo/discussion"}, {"GET", "/api/home/notifications"}} {
		if w := homeRequest(t, s, request.method, request.path, `{}`, false); w.Code != 401 {
			t.Fatalf("anonymous %s: %d", request.path, w.Code)
		}
	}
	got := homeDecode[home.Snapshot](t, homeRequest(t, s, "GET", "/api/home", "", true), 200)
	if got.Available || got.Reason == "" {
		t.Fatal("missing registry should be unavailable")
	}
}

func TestHomeAPIRebuildAndTaskWrites(t *testing.T) {
	_, s := newTestServer(t, inProcessTestServer)
	project := homeFixture(t, s)
	s.Cfg.Development = true
	task := homeDecode[home.Task](t, homeRequest(t, s, "POST", "/api/home/projects/demo/tasks", `{"id":"A2","title":"Backend","stage":"A","status":"awaiting_review","body":"Acceptance\n"}`, true), 201)
	if w := homeRequest(t, s, "POST", "/api/home/projects/demo/tasks", `{"id":"A2","title":"Again"}`, true); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	body := `{"rev":"` + task.Rev + `","status":"blocked","blockedReason":"Review me"}`
	patched := homeDecode[home.Task](t, homeRequest(t, s, "PATCH", "/api/home/projects/demo/tasks/A2", body, true), 200)
	if patched.Status != "blocked" || patched.Body != "Acceptance\n" {
		t.Fatalf("%+v", patched)
	}
	stale := homeDecode[map[string]string](t, homeRequest(t, s, "PATCH", "/api/home/projects/demo/tasks/A2", body, true), 409)
	if stale["error"] != "stale" || stale["rev"] != patched.Rev {
		t.Fatal(stale)
	}
	a := homeDecode[home.Snapshot](t, homeRequest(t, s, "GET", "/api/home", "", true), 200)
	detail := homeDecode[home.Detail](t, homeRequest(t, s, "GET", "/api/home/projects/demo", "", true), 200)
	if len(a.Projects) != 1 || len(a.Todos) != 1 || detail.Tasks[0].Rev != patched.Rev || a.Projects[0].Usage.Known {
		t.Fatal("index/detail shape")
	}
	_, fresh := newTestServer(t, inProcessTestServer)
	fresh.Cfg.CyxHome = s.Cfg.CyxHome
	// Both runtime databases have only authentication; all work is rebuilt from files.
	b := homeDecode[home.Snapshot](t, homeRequest(t, fresh, "GET", "/api/home", "", true), 200)
	if !reflect.DeepEqual(a.Projects, b.Projects) || !reflect.DeepEqual(a.Todos, b.Todos) {
		t.Fatal("fresh database changed work")
	}
	homePut(t, filepath.Join(project, "project.json"), `{"id":"demo","status":"merged"}`)
	if len(homeDecode[home.Snapshot](t, homeRequest(t, s, "GET", "/api/home", "", true), 200).Projects) != 0 || len(homeDecode[home.Snapshot](t, homeRequest(t, s, "GET", "/api/home?all=1", "", true), 200).Projects) != 1 {
		t.Fatal("all filter")
	}
}

func TestHomeAPILiveSessionsAndManualGate(t *testing.T) {
	_, s := newTestServer(t, inProcessTestServer)
	homeFixture(t, s)
	link := filepath.Join(s.Cfg.DataDir, "checkout-link")
	if err := os.Symlink(s.Cfg.DataDir, link); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := s.DB.CreateProject(ctx, "panel", "Panel", link); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.CreateSession(ctx, store.Session{ID: "live", ProjectID: "panel", TmuxName: "vp_live", Title: "Live", State: session.StateWaiting, Command: "claude"}); err != nil {
		t.Fatal(err)
	}
	got := homeDecode[home.Snapshot](t, homeRequest(t, s, "GET", "/api/home", "", true), 200)
	if got.Projects[0].PanelProjectID == nil || *got.Projects[0].PanelProjectID != "panel" || len(got.Todos) != 1 || got.Todos[0].Link.SessionID != "live" {
		t.Fatalf("%+v", got)
	}
	s.Cfg.Development = true
	path := "/api/home/projects/demo/sessions"
	if w := homeRequest(t, s, "POST", path, `{}`, true); w.Code != 403 {
		t.Fatal("development launch", w.Code)
	}
	s.Cfg.DevelopmentTerminal = true
	// Reaching the normal profile lookup proves the shared launch path without
	// starting a tmux server. It must refuse before touching tmux.
	if w := homeRequest(t, s, "POST", path, `{"profileId":"missing"}`, true); w.Code != 404 {
		t.Fatal("manual launch", w.Code, w.Body.String())
	}
	s.Cfg.PlanningOnly = true
	if w := homeRequest(t, s, "POST", path, `{}`, true); w.Code != 403 {
		t.Fatal("planning launch", w.Code)
	}
	for _, path := range []string{"/api/home/projects/demo/execute", "/api/home/projects/demo/tasks/A2/approve", "/api/home/other"} {
		if homePlanningRoute("POST", path) || developmentTerminalRoute("POST", path) {
			t.Fatal("gate widened", path)
		}
	}
}

func TestHomeAPISessionCreatesValidatedProject(t *testing.T) {
	_, s := newTestServer(t, inProcessTestServer)
	homeFixture(t, s)
	w := homeRequest(t, s, "POST", "/api/home/projects/demo/sessions", `{"profileId":"missing"}`, true)
	if w.Code != 404 {
		t.Fatal(w.Code, w.Body.String())
	}
	projects, err := s.DB.ListAllProjects(context.Background())
	if err != nil || len(projects) != 1 || projects[0].Path != s.Cfg.DataDir {
		t.Fatalf("%+v %v", projects, err)
	}
	_ = homeRequest(t, s, "POST", "/api/home/projects/demo/sessions", `{"profileId":"missing"}`, true)
	projects, err = s.DB.ListAllProjects(context.Background())
	if err != nil || len(projects) != 1 {
		t.Fatal("duplicate panel project")
	}
}

func TestHomeNotificationBaselineDedupAndDryRun(t *testing.T) {
	_, s := newTestServer(t, inProcessTestServer)
	project := homeFixture(t, s)
	path := filepath.Join(project, "agent-docs/tasks/A2/task.md")
	writeTask := func(title string) { homePut(t, path, "---\nid: A2\ntitle: "+title+"\nstatus: awaiting_review\n---\n") }
	writeTask("Existing")
	s.Cfg.HomeNotify = "dry_run"
	s.Cfg.BasePath = "/dev"
	s.Cfg.HomePublicURL = "https://panel.test"
	s.homeNotifications.send = func(context.Context, store.HomeDelivery) error { t.Fatal("dry run called adapter"); return nil }
	ctx := context.Background()
	now := time.Now().Truncate(time.Second)
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	if rows, err := s.DB.HomeDeliveries(ctx); err != nil || len(rows) != 0 {
		t.Fatal("baseline should not be sent")
	}
	if empty, err := s.DB.HomeDeliveriesEmpty(ctx); err != nil || empty {
		t.Fatal("baseline not persisted")
	}
	s.homeNotifications.initialized = false
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	writeTask("New review")
	for n := 0; n < 2; n++ {
		if err := s.homeNotificationTick(ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.DB.HomeDeliveries(ctx)
	if err != nil || len(rows) != 1 || rows[0].Status != "dry_run" || rows[0].Peer != "" || !strings.Contains(rows[0].Text, "https://panel.test/dev/home?project=demo&task=A2") {
		t.Fatalf("%+v %v", rows, err)
	}
	result := homeDecode[struct {
		Mode  string               `json:"mode"`
		Items []store.HomeDelivery `json:"items"`
	}](t, homeRequest(t, s, "GET", "/dev/api/home/notifications", "", true), 200)
	if result.Mode != "dry_run" || len(result.Items) != 1 {
		t.Fatal(result)
	}
}

func TestHomeNotificationEmptyBaselineRetriesExpiryAndOff(t *testing.T) {
	_, s := newTestServer(t, inProcessTestServer)
	project := homeFixture(t, s)
	ctx := context.Background()
	now := time.Now().Truncate(time.Second)
	for _, peer := range []store.ChatPeer{{Channel: "feishu", PeerID: "owner", Status: store.PeerPaired, Mode: store.ModeNormal}, {Channel: "telegram", PeerID: "other", Status: store.PeerPaired, Mode: store.ModeNormal}} {
		if err := s.DB.PutChatPeer(ctx, peer); err != nil {
			t.Fatal(err)
		}
	}
	s.Cfg.HomeNotify = "send"
	calls := 0
	s.homeNotifications.send = func(_ context.Context, n store.HomeDelivery) error {
		calls++
		if n.Peer != "owner" || n.Channel != "feishu" {
			t.Fatal("wrong recipient")
		}
		return errors.New("offline")
	}
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	homePut(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Blockers**: access\n")
	for _, offset := range []time.Duration{0, 30 * time.Second, time.Minute, 2 * time.Minute, 3 * time.Minute, 10 * time.Minute} {
		if err := s.homeNotificationTick(ctx, now.Add(offset)); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.DB.HomeDeliveries(ctx)
	if err != nil || calls != 3 || len(rows) != 1 || rows[0].Attempts != 3 || rows[0].Status != "failed" {
		t.Fatalf("%+v calls=%d %v", rows, calls, err)
	}
	s.homeNotifications.send = func(context.Context, store.HomeDelivery) error { calls++; return nil }
	homePut(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Blockers**: new blocker\n")
	if err := s.homeNotificationTick(ctx, now.Add(11*time.Minute)); err != nil {
		t.Fatal(err)
	}
	rows, _ = s.DB.HomeDeliveries(ctx)
	if calls != 4 || rows[0].Status != "sent" || rows[0].SentAt == nil {
		t.Fatal("send success")
	}
	if err := s.DB.RecordHomeDeliveries(ctx, []store.HomeDelivery{{TodoID: "expired", ProjectID: "demo", Channel: "feishu", Peer: "owner", Status: "pending", CreatedAt: now.Add(-25 * time.Hour).Format(time.RFC3339)}}); err != nil {
		t.Fatal(err)
	}
	if err := s.homeNotificationTick(ctx, now.Add(12*time.Minute)); err != nil {
		t.Fatal(err)
	}
	rows, _ = s.DB.HomeDeliveries(ctx)
	if calls != 4 || rows[0].Status != "failed" || rows[0].Attempts != 0 {
		t.Fatal("expiry sent")
	}
	s.Cfg.HomeNotify = "off"
	homePut(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Blockers**: off blocker\n")
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	rows, _ = s.DB.HomeDeliveries(ctx)
	if len(rows) != 3 || calls != 4 {
		t.Fatal("off wrote or sent")
	}
	if text := homeNotificationText(home.Todo{ProjectID: "demo", Kind: "session_waiting", Title: "Waiting", Link: home.TodoLink{SessionID: "session"}}, "", "/dev", "en"); !strings.HasSuffix(text, "/dev/?session=session") {
		t.Fatal(text)
	}
}

func TestHomeNotificationNoRecipientAndPairedDryRun(t *testing.T) {
	_, s := newTestServer(t, inProcessTestServer)
	project := homeFixture(t, s)
	s.Cfg.HomeNotify = "send"
	ctx := context.Background()
	now := time.Now().Truncate(time.Second)
	s.homeNotifications.send = func(context.Context, store.HomeDelivery) error { t.Fatal("dry run called adapter"); return nil }
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	homePut(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Blockers**: no recipient\n")
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	rows, err := s.DB.HomeDeliveries(ctx)
	if err != nil || len(rows) != 1 || rows[0].Status != "dry_run" || rows[0].Peer != "" {
		t.Fatalf("fallback: %+v %v", rows, err)
	}
	if err := s.DB.PutChatPeer(ctx, store.ChatPeer{Channel: "feishu", PeerID: "owner", Status: store.PeerPaired, Mode: store.ModeNormal}); err != nil {
		t.Fatal(err)
	}
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	rows, _ = s.DB.HomeDeliveries(ctx)
	if len(rows) != 1 {
		t.Fatal("old todo replayed to new recipient")
	}
	s.Cfg.HomeNotify = "dry_run"
	homePut(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Blockers**: paired dry run\n")
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	rows, _ = s.DB.HomeDeliveries(ctx)
	if len(rows) != 2 || rows[0].Peer != "owner" || rows[0].Status != "dry_run" {
		t.Fatalf("paired dry run: %+v", rows)
	}
}

func TestHomeDiscussionPromptUsesRecentEvidence(t *testing.T) {
	detail := home.Detail{}
	for n := 0; n < 7; n++ {
		detail.Reports = append(detail.Reports, home.Report{ReportSummary: home.ReportSummary{Title: fmt.Sprintf("report-%d", n)}})
	}
	messages := []store.HomeMessage{}
	for n := 0; n < 19; n++ {
		messages = append(messages, store.HomeMessage{Role: "user", Text: fmt.Sprintf("message-%02d", n)})
	}
	prompt := homeDiscussionPrompt(detail, messages, "latest")
	for _, absent := range []string{"report-5", "report-6", "message-00", "message-01", "message-02"} {
		if strings.Contains(prompt, absent) {
			t.Fatal("old context", absent)
		}
	}
	for _, present := range []string{"report-4", "message-03", "message-18"} {
		if !strings.Contains(prompt, present) {
			t.Fatal("missing context", present)
		}
	}
}
