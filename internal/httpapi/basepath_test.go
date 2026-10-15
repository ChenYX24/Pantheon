package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/auth"
)

func TestDevelopmentMountSeparatesRoutesAndCredentials(t *testing.T) {
	original, srv := newUnconfiguredServer(t)
	original.Close()
	srv.Cfg.BasePath, srv.Cfg.Development, srv.Cfg.StaticDir = "/dev", true, ""
	ts := httptest.NewServer(srv.Routes())
	defer ts.Close()
	jar, _ := cookiejar.New(nil)
	client := ts.Client()
	client.Jar = jar
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for path, want := range map[string]int{"/api/auth/state": 404, "/": 404, "/development/api/auth/state": 404, "/dev": 307, "/dev/projects": 200, "/dev/api/auth/state": 200, "/dev/api/state": 401} {
		res, err := client.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("%s: %d, want %d", path, res.StatusCode, want)
		}
		if path == "/dev" && res.Header.Get("Location") != "/dev/projects" {
			t.Fatal("mount redirect escaped")
		}
	}
	res, err := client.Post(ts.URL+"/dev/api/auth/setup", "application/json", strings.NewReader(`{"token":"test-setup-token","username":"tester","password":"a sufficiently long password"}`))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("setup: %d %s", res.StatusCode, body)
	}
	cookies := res.Cookies()
	if len(cookies) != 1 || cookies[0].Path != "/dev/" || cookies[0].Name == auth.CookieName {
		t.Fatalf("cookies were not scoped: %+v", cookies)
	}
	req, _ := http.NewRequest("GET", ts.URL+"/dev/api/state", nil)
	// Even a valid development token under the live instance's name is refused.
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: cookies[0].Value})
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("root cookie was accepted by development")
	}
	res, err = client.Get(ts.URL + "/dev/api/state")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("scoped login: %d", res.StatusCode)
	}
	res, err = client.Post(ts.URL+"/dev/api/auth/logout", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 204 {
		t.Fatalf("logout: %d", res.StatusCode)
	}
	for _, cookie := range res.Cookies() {
		if cookie.Name == auth.CookieName || cookie.Path != "/dev/" {
			t.Fatal("logout touched root cookie")
		}
	}
}

func TestPluginBasePathKeepsGrantsFilesAndModulesOnTheMount(t *testing.T) {
	srv := newInProcessTestServer(t)
	// Exercise the mounted handlers independently of development's existing
	// host-administration gate, whose refusal is checked at the end.
	srv.Cfg.BasePath = "/dev"
	add := func(manifest string, files map[string]string) {
		t.Helper()
		r := httptest.NewRequest("POST", "http://panel.test/dev/api/settings/plugins", bytes.NewReader(pluginZip(t, manifest, files)))
		r.Header.Set("Content-Type", "application/zip")
		r.AddCookie(&http.Cookie{Name: auth.CookieNameAt(auth.CookieName, "/dev"), Value: "home-cookie"})
		w := httptest.NewRecorder()
		srv.Routes().ServeHTTP(w, r)
		if w.Code != http.StatusCreated {
			t.Fatalf("add: %d %s", w.Code, w.Body.String())
		}
	}
	request := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := homeRequest(t, srv, method, path, body, true)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w
	}
	add(paneManifest, map[string]string{"pane.html": "<p>pane</p>"})
	request("POST", "/dev/api/settings/plugins/pane/install", `{"caps":[]}`, 200)
	w := request("POST", "/dev/api/settings/plugins/pane/grant", `{}`, 201)
	var g mintedGrant
	if err := json.Unmarshal(w.Body.Bytes(), &g); err != nil {
		t.Fatal(err)
	}
	if g.Base != "/dev/plugin/"+g.Grant+"/" || g.API != "/dev/api/plugin/"+g.Grant+"/v1/" {
		t.Fatalf("grant URLs = %+v", g)
	}
	w = homeRequest(t, srv, "GET", g.Base+"pane.html", "", false)
	if w.Code != 200 {
		t.Fatalf("frame: %d %s", w.Code, w.Body.String())
	}
	csp := w.Header().Get("Content-Security-Policy")
	for _, path := range []string{g.Base, g.API} {
		if !strings.Contains(csp, "http://panel.test"+path) {
			t.Errorf("CSP lacks mounted %s: %s", path, csp)
		}
	}
	if strings.Contains(csp, "http://panel.test/api/") || strings.Contains(csp, "http://panel.test/plugin/") || strings.Contains(csp, "allow-same-origin") {
		t.Fatalf("frame escaped its mount or sandbox: %s", csp)
	}
	if w := homeRequest(t, srv, "GET", g.API+"me", "", false); w.Code != 200 {
		t.Fatalf("grant is not bound to the mounted session: %d %s", w.Code, w.Body.String())
	}
	request("GET", "/api/settings/plugins", "", 404)
	w = request("POST", "/dev/api/settings/plugins/pane/tokens", `{"name":"test"}`, 201)
	if !strings.Contains(w.Body.String(), `"mount":"/dev/api/plugin-http/pane/"`) {
		t.Fatalf("process mount escaped: %s", w.Body.String())
	}
	add(moduleManifest, map[string]string{"main.mjs": "export default function () {}"})
	request("POST", "/dev/api/settings/plugins/mod/install", `{"caps":[]}`, 200)
	request("GET", "/dev/plugin-code/mod/main.mjs", "", 403)
	request("PUT", "/dev/api/settings/plugin-unsandboxed", `{"enabled":true}`, 200)
	w = request("GET", "/dev/api/settings/plugin-modules", "", 200)
	if !strings.Contains(w.Body.String(), `"url":"/dev/plugin-code/mod/main.mjs"`) {
		t.Fatalf("module escaped: %s", w.Body.String())
	}
	request("GET", "/dev/plugin-code/mod/main.mjs", "", 200)
	if got := srv.attachmentURL("s1", "report.txt"); !strings.Contains(got, "/dev/api/sessions/s1/attachments/report.txt") {
		t.Fatalf("attachment escaped: %s", got)
	}
	if env := strings.Join(srv.hookEnv(t.Context(), "s1", "p1"), "\n"); !strings.Contains(env, "VIBEPANEL_URL="+srv.Cfg.LoopbackURL()+"/dev") {
		t.Fatalf("session CLI URL escaped: %s", env)
	}
	request("POST", "/dev/api/auth/logout", `{}`, 204)
	if w := homeRequest(t, srv, "GET", g.API+"me", "", false); w.Code != 401 {
		t.Fatalf("signed-out grant survived: %d", w.Code)
	}
	// A mounted URL does not make plugin administration a planning operation.
	if err := srv.DB.CreateAuthSession(t.Context(), auth.HashToken("home-cookie"), "home-test", time.Hour, "test", "127.0.0.1", "http://panel.test"); err != nil {
		t.Fatal(err)
	}
	srv.Cfg.Development = true
	request("GET", "/dev/api/settings/plugins", "", 403)
}
