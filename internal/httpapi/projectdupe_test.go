package httpapi

import (
	"net/http"
	"strings"
	"testing"
)

// A directory is one project: a second POST for the same path is a 409
// naming the first, and the sidebar never has two rows for one place.
func TestADirectoryIsOneProject(t *testing.T) {
	ts, _ := newTestServer(t)
	dir := t.TempDir()
	if status, body := doJSON(t, ts, http.MethodPost, "/api/projects", `{"name":"first","path":"`+dir+`"}`); status != http.StatusCreated {
		t.Fatalf("first: %d %s", status, body)
	}
	status, body := doJSON(t, ts, http.MethodPost, "/api/projects", `{"name":"second","path":"`+dir+`/"}`)
	if status != http.StatusConflict || !strings.Contains(string(body), "already the project first") {
		t.Errorf("second: %d %s", status, body)
	}
}
