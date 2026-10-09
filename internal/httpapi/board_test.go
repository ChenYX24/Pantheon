package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestBoardAuthenticationAndPlanningIsolation(t *testing.T) {
	ts, srv := newTestServer(t)
	if _, err := srv.DB.CreateProject(context.Background(), "board", "Board", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	url := ts.URL + "/api/projects/board/board"
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unauthenticated board: %d", res.StatusCode)
	}
	srv.Cfg.PlanningOnly = true
	for _, c := range []struct {
		method, path, body string
		want               int
	}{
		{"GET", "/api/projects/board/board", "", 200},
		{"PUT", "/api/projects/board/board", `{"goal":"ship","rev":0,"tasks":[]}`, 200},
		{"PUT", "/api/projects/board/board", `{"goal":"stale","rev":0,"tasks":[]}`, 409},
		{"PUT", "/api/projects/board/board", `{"rev":1,"tasks":[{"id":"a","title":"x","status":"done"}]}`, 400},
		{"POST", "/api/sessions", `{}`, 403},
		{"POST", "/api/settings/restart", `{}`, 403},
	} {
		req, _ := http.NewRequest(c.method, ts.URL+c.path, strings.NewReader(c.body))
		req.Header.Set("Content-Type", "application/json")
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != c.want {
			t.Errorf("%s %s: got %d, want %d", c.method, c.path, res.StatusCode, c.want)
		}
	}
}
