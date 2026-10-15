package webui

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestMountedRewritesNeverUseUnrewrittenGzip(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"index.html":           `<html><head><link href="/plugin-themes.css"></head><body><script src="/assets/app.js"></script></body></html>` + strings.Repeat("<!-- padding -->", 100),
		"manifest.webmanifest": `{"scope":"/","start_url":"/","icons":[{"src":"/icon.png"}],"description":"` + strings.Repeat("padding ", 100) + `"}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	h := HandlerAt(dir, "").(spaHandler)
	// Warm the original-file cache first; a mounted rewrite must not read it.
	for _, path := range []string{"/index.html", "/manifest.webmanifest"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Header().Get("Content-Encoding") != "gzip" {
			t.Fatalf("fixture did not warm gzip for %s", path)
		}
	}
	h.basePath = "/dev"
	for _, path := range []string{"/", "/plugins", "/x/standup", "/index.html", "/manifest.webmanifest"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 || rec.Header().Get("Content-Encoding") != "" {
			t.Fatalf("mounted %s: %d %v", path, rec.Code, rec.Header())
		}
		want := []string{`href="/dev/plugin-themes.css"`, `src="/dev/assets/app.js"`, `content="/dev"`}
		if path == "/manifest.webmanifest" {
			want = []string{`"scope":"/dev/"`, `"start_url":"/dev/projects"`, `"src":"/dev/icon.png"`}
		}
		for _, value := range want {
			if !strings.Contains(rec.Body.String(), value) {
				t.Errorf("mounted %s lacks %s", path, value)
			}
		}
	}
}
