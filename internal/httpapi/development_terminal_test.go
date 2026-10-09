package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestDevelopmentTerminalManualSessionAndReadPanels(t *testing.T) {
	ts, srv := newTestServer(t)
	srv.Cfg.Development, srv.Cfg.DevelopmentTerminal = true, true
	srv.Tokens = nil // Development must not ingest the real user's transcripts.
	if _, err := srv.DB.CreateProject(context.Background(), "fixture", "Fixture", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/system", "/api/usage", "/api/resources", "/api/launch-profiles", "/api/projects/fixture/files"} {
		code, _ := send(t, ts, http.MethodGet, path, "")
		if code != http.StatusOK {
			t.Errorf("GET %s: %d, want 200", path, code)
		}
	}
	code, body := send(t, ts, http.MethodGet, "/api/token-usage", "")
	if code != 200 || !strings.Contains(body, `"unavailableReason":"development"`) {
		t.Errorf("disabled usage should be explicit, not an HTTP failure: %d %s", code, body)
	}
	code, body = send(t, ts, http.MethodPost, "/api/sessions", `{"projectId":"fixture","command":["/bin/sh"],"title":"manual fixture"}`)
	if code != http.StatusCreated {
		t.Fatalf("manual session: %d %s", code, body)
	}
	var session struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(body), &session); err != nil || session.ID == "" {
		t.Fatalf("session response: %v", err)
	}
	code, body = send(t, ts, http.MethodDelete, "/api/sessions/"+session.ID, "")
	if code != http.StatusNoContent {
		t.Fatalf("delete own fixture: %d %s", code, body)
	}
}

func TestDevelopmentTerminalKeepsHostAdministrationBlocked(t *testing.T) {
	ts, srv := newTestServer(t)
	srv.Cfg.Development, srv.Cfg.DevelopmentTerminal = true, true
	for _, request := range []struct{ method, path string }{
		{"POST", "/api/settings/restart"}, {"POST", "/api/settings/hooks"},
		{"PUT", "/api/settings/env"}, {"POST", "/api/settings/tune"},
		{"POST", "/api/resources/kill"}, {"PUT", "/api/resources/policy"},
		{"POST", "/api/token-usage/refresh"},
	} {
		code, _ := send(t, ts, request.method, request.path, `{}`)
		if code != http.StatusForbidden {
			t.Errorf("%s %s: %d, want 403", request.method, request.path, code)
		}
	}
	res, err := http.Post(ts.URL+"/api/sessions", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous launch: %d", res.StatusCode)
	}
}

func TestDevelopmentTerminalMissingSupervisorLeavesNoOrphan(t *testing.T) {
	ts, srv := newTestServer(t)
	srv.Cfg.Development, srv.Cfg.DevelopmentTerminal = true, true
	ctx := context.Background()
	if _, err := srv.DB.CreateProject(ctx, "fixture", "Fixture", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	srv.Tmux.ExternallyManaged = true
	if err := srv.Tmux.KillServer(ctx); err != nil {
		t.Fatal(err)
	}
	code, _ := send(t, ts, http.MethodPost, "/api/sessions", `{"projectId":"fixture","command":["/bin/sh"]}`)
	if code != http.StatusInternalServerError {
		t.Fatalf("missing supervisor: %d", code)
	}
	rows, err := srv.DB.ListSessions(ctx)
	if err != nil || len(rows) != 0 {
		t.Fatalf("failed launch left rows: %d, %v", len(rows), err)
	}
	if srv.Tmux.ServerRunning(ctx) {
		t.Fatal("failed launch recreated tmux in the backend group")
	}
}
