package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/store"
)

func TestPlanningPreviewReadsProfilesWithoutEnablingExecution(t *testing.T) {
	for _, mode := range []string{"planning-only", "development"} {
		t.Run(mode, func(t *testing.T) {
			ts, srv := newTestServer(t)
			srv.Cfg.PlanningOnly = mode == "planning-only"
			srv.Cfg.Development = mode == "development"
			ctx := context.Background()
			profile := store.LaunchProfile{
				Name: "Synthetic copied profile", Command: []string{"fixture-agent"},
				Env: []store.LaunchEnvVar{{Name: "TEST_API_KEY", Value: "fixture-secret-only", Secret: true}},
			}
			if err := srv.DB.UpsertLaunchProfile(ctx, "fixture-profile", profile); err != nil {
				t.Fatal(err)
			}
			res, err := http.Get(ts.URL + "/api/launch-profiles")
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != http.StatusUnauthorized {
				t.Errorf("anonymous profile read: %d, want 401", res.StatusCode)
			}
			code, body := send(t, ts, http.MethodGet, "/api/launch-profiles", "")
			if code != http.StatusOK {
				t.Errorf("authenticated profile read: %d, want 200", code)
			} else {
				var got []store.LaunchProfile
				if err := json.Unmarshal([]byte(body), &got); err != nil {
					t.Fatal(err)
				}
				if len(got) != len(store.BuiltinLaunchProfiles())+1 {
					t.Errorf("got %d profiles, want built-ins and the copied profile", len(got))
				}
				found := false
				for _, row := range got {
					if row.ID == "fixture-profile" {
						found = true
						if len(row.Env) != 1 || row.Env[0].Value != "" || !row.Env[0].HasValue {
							t.Error("profile read did not retain secret redaction metadata")
						}
					}
				}
				if !found || strings.Contains(body, "fixture-secret-only") {
					t.Error("copied profile missing or secret value leaked")
				}
			}
			for _, request := range []struct{ method, path string }{
				{http.MethodPost, "/api/launch-profiles"},
				{http.MethodPatch, "/api/launch-profiles/fixture-profile"},
				{http.MethodDelete, "/api/launch-profiles/fixture-profile"},
				{http.MethodPost, "/api/launch-profiles/reorder"},
				{http.MethodPost, "/api/sessions"},
				{http.MethodPost, "/api/settings/restart"},
				{http.MethodPost, "/api/settings/hooks"},
			} {
				code, _ := send(t, ts, request.method, request.path, `{}`)
				if code != http.StatusForbidden {
					t.Errorf("%s %s: %d, want 403", request.method, request.path, code)
				}
			}
		})
	}
}
