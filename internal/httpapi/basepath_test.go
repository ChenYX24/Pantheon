package httpapi

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

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
