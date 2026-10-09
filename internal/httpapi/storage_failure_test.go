package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestProjectWriteFailureMarksStorageUnhealthy(t *testing.T) {
	ts, srv := newTestServer(t)
	// Keep reads/auth working while the actual insert fails. Closing the whole
	// database only tests authentication's earlier failure, never this branch.
	srv.DB.SQL().SetMaxOpenConns(1)
	if _, err := srv.DB.SQL().Exec("PRAGMA query_only=ON"); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = srv.DB.SQL().Exec("PRAGMA query_only=OFF") }()
	res, err := ts.Client().Post(ts.URL+"/api/projects", "application/json", strings.NewReader(`{"name":"write failure","path":"`+t.TempDir()+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("create status: %d", res.StatusCode)
	}
	srv.staleMu.Lock()
	recorded := !srv.staleSince.IsZero()
	srv.staleSince = time.Now().Add(-2 * staleGrace)
	srv.staleMu.Unlock()
	if !recorded {
		t.Fatal("failed project insert was not reported to storage health")
	}
	res, err = ts.Client().Get(ts.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var health struct {
		OK    bool   `json:"ok"`
		Stale string `json:"stale"`
	}
	if err := json.NewDecoder(res.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if health.OK || health.Stale == "" {
		t.Fatal("health endpoint hid a failed project write before recovery")
	}
}
