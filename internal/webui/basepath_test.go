package webui

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMountedHTMLAndManifest(t *testing.T) {
	handler := HandlerAt("", "/dev")
	for _, path := range []string{"/", "/projects", "/index.html"} {
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		body := res.Body.String()
		for _, expected := range []string{`name="vibepanel-base" content="/dev"`, `href="/dev/manifest.webmanifest"`, `src="/dev/assets/`, `vibepanel:/dev:vibepanel.theme`} {
			if !strings.Contains(body, expected) {
				t.Errorf("%s missing %s", path, expected)
			}
		}
		if res.Header().Get("Cache-Control") != "no-cache" {
			t.Fatal("mounted index may cache a stale bundle")
		}
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest("GET", "/manifest.webmanifest", nil))
	var manifest struct {
		Scope, ID string
		Start     string `json:"start_url"`
		Icons     []struct{ Src string }
	}
	if err := json.Unmarshal(res.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Scope != "/dev/" || manifest.ID != "/dev/" || manifest.Start != "/dev/projects" {
		t.Fatalf("manifest scope: %+v", manifest)
	}
	for _, icon := range manifest.Icons {
		if !strings.HasPrefix(icon.Src, "/dev/") {
			t.Errorf("icon escaped: %s", icon.Src)
		}
	}
}
