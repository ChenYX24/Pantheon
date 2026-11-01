package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"

	"github.com/jiangmuran/vibepanel/internal/auth"
)

const memberMarker = "from-the-member-instance"

// fakeInstance stands in for a member's panel. It records what reached it and
// answers with whatever a hostile instance might: a document with a script, a
// cookie for the owner's session, Clear-Site-Data.
type fakeInstance struct {
	*httptest.Server
	mu   sync.Mutex
	seen []*http.Request
}

func newFakeInstance(t *testing.T) *fakeInstance {
	t.Helper()
	f := &fakeInstance{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.seen = append(f.seen, r.Clone(context.Background()))
		f.mu.Unlock()
		h := w.Header()
		h.Set("Set-Cookie", "vibepanel_session=stolen; Path=/")
		h.Set("Clear-Site-Data", `"*"`)
		h.Set("Location", "https://elsewhere.example/")
		h.Set("Service-Worker-Allowed", "/")
		h.Set("X-Preview-Markup", "html")
		switch {
		case r.URL.Path == "/ws":
			c, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer c.CloseNow() //nolint:errcheck // test
			for {
				typ, b, err := c.Read(r.Context())
				if err != nil {
					return
				}
				if c.Write(r.Context(), typ, b) != nil {
					return
				}
			}
		case strings.HasSuffix(r.URL.Path, ".js"):
			h.Set("Content-Type", "text/javascript")
			_, _ = io.WriteString(w, "alert('"+memberMarker+"')")
		case strings.HasSuffix(r.URL.Path, ".svg"):
			h.Set("Content-Type", "image/svg+xml")
			_, _ = io.WriteString(w, `<svg xmlns="http://www.w3.org/2000/svg"><script>/*`+memberMarker+`*/</script></svg>`)
		case strings.HasPrefix(r.URL.Path, "/api/home") || r.URL.Path == "/api/state":
			h.Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"marker":"`+memberMarker+`","path":"`+r.URL.Path+`"}`)
		default:
			h.Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, `<script>fetch('/api/state')</script>`+memberMarker)
		}
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeInstance) requests() []*http.Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.seen)
}

func (f *fakeInstance) upstream() string { return strings.TrimPrefix(f.URL, "http://") }

const memberPassword = "a member's long password"

// addMember creates a member through the owner's API and returns a client
// signed in as that member.
func addMember(t *testing.T, ts *httptest.Server, name string, f *fakeInstance) (*http.Client, string) {
	t.Helper()
	m := postJSON[map[string]any](t, ts, "/api/members", fmt.Sprintf(
		`{"username":%q,"password":%q,"linuxUser":%q,"upstream":%q,"token":"gateway-bearer-%s"}`,
		name, memberPassword, name, f.upstream(), name))
	c := anonymousClient(t)
	res, err := c.Post(ts.URL+"/api/auth/login", "application/json",
		strings.NewReader(fmt.Sprintf(`{"username":%q,"password":%q}`, name, memberPassword)))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.Contains(string(b), `"member":true`) {
		t.Fatalf("member login: %s %s", res.Status, b)
	}
	return c, m["id"].(string)
}

func memberDo(t *testing.T, c *http.Client, method, u string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(method, u, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, u, err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, string(b)
}

func concrete(route string) string {
	out := []string{}
	for _, seg := range strings.Split(route, "/") {
		if strings.HasPrefix(seg, "{") || seg == "*" {
			seg = "x"
		}
		out = append(out, seg)
	}
	return strings.Join(out, "/")
}

// With a member's cookie, no owner handler under /api ever runs: each route
// is answered by the member's instance, refused, or is one of the five the
// gateway answers itself. The owner's side of the panel is never told about
// members, and this is what checks that it does not need to be.
func TestAMemberNeverReachesAnOwnerHandler(t *testing.T) {
	ts, srv := newTestServer(t)
	f := newFakeInstance(t)
	c, _ := addMember(t, ts, "li", f)
	self := map[string]bool{"/api/health": true, "/api/auth/login": true, "/api/auth/state": true, "/api/auth/logout": true, "/api/auth/password": true}
	err := chi.Walk(srv.Routes().(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, "/api/") || self[route] || method == http.MethodOptions {
			return nil
		}
		before := len(f.requests())
		res, body := memberDo(t, c, method, ts.URL+concrete(route))
		switch {
		case res.StatusCode == http.StatusNotFound && strings.Contains(body, "not available to members"):
		case strings.Contains(body, memberMarker):
		// A HEAD has no body to carry the marker; that it reached the
		// member's instance is the answer.
		case method == http.MethodHead && len(f.requests()) == before+1:
		case method == http.MethodHead && res.StatusCode == http.StatusNotFound && len(f.requests()) == before:
		default:
			t.Errorf("%s %s with a member's cookie: %d %.120s", method, route, res.StatusCode, body)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// A member's credentials, presented the ways an owner's are, are unknown.
func TestAMemberCredentialIsUnknownToTheOwnerRoutes(t *testing.T) {
	ts, _ := newTestServer(t)
	f := newFakeInstance(t)
	c, _ := addMember(t, ts, "li", f)
	u, _ := url.Parse(ts.URL)
	var memberToken string
	for _, ck := range c.Jar.Cookies(u) {
		if ck.Name == memberCookieName {
			memberToken = ck.Value
		}
	}
	if memberToken == "" {
		t.Fatal("no member cookie after sign-in")
	}
	for _, how := range []string{"owner cookie", "bearer", "gateway bearer"} {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/state", nil)
		switch how {
		case "owner cookie":
			req.Header.Set("Cookie", "vibepanel_session="+memberToken)
		case "bearer":
			req.Header.Set("Authorization", "Bearer "+memberToken)
		case "gateway bearer":
			req.Header.Set("Authorization", "Bearer gateway-bearer-li")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("a member's token as %s on /api/state = %d", how, res.StatusCode)
		}
	}
	if n := len(f.requests()); n != 0 {
		t.Errorf("%d requests reached the member's instance without the member's cookie", n)
	}
}

// What comes back from a member's instance is data. Nothing it says can set
// a cookie on this origin, clear it, redirect it, or run as a document with
// it in reach; nothing the browser holds for the owner is sent to it.
func TestAMemberInstanceSendsDataNotDocuments(t *testing.T) {
	ts, _ := newTestServer(t)
	f := newFakeInstance(t)
	c, _ := addMember(t, ts, "li", f)
	u, _ := url.Parse(ts.URL)
	// The same browser signed in as the owner too: the worst case for what
	// could leak to the member's instance.
	c.Jar.SetCookies(u, []*http.Cookie{{Name: "vibepanel_session", Value: "owner-secret", Path: "/"}})

	for _, tc := range []struct {
		path    string
		sandbox bool
		ctype   string
	}{
		{"/api/projects/x/raw/page.html", true, "text/html"},
		{"/api/projects/x/raw/pic.svg", true, "image/svg+xml"},
		{"/api/projects/x/raw/app.js", false, "application/octet-stream"},
		{"/api/home", false, "application/json"},
	} {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+tc.path, nil)
		req.Header.Set("Origin", ts.URL)
		req.Header.Set("Referer", ts.URL+"/projects")
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		h := res.Header
		for _, bad := range []string{"Set-Cookie", "Clear-Site-Data", "Location", "Service-Worker-Allowed"} {
			if h.Get(bad) != "" {
				t.Errorf("%s: %s passed through: %q", tc.path, bad, h.Get(bad))
			}
		}
		if h.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: no nosniff", tc.path)
		}
		if got := h.Get("Content-Type"); !strings.HasPrefix(got, tc.ctype) {
			t.Errorf("%s: Content-Type %q, want %s", tc.path, got, tc.ctype)
		}
		sandboxed := slices.ContainsFunc(h.Values("Content-Security-Policy"), func(v string) bool {
			return strings.HasPrefix(v, "sandbox") && !strings.Contains(v, "allow-same-origin")
		})
		if sandboxed != tc.sandbox {
			t.Errorf("%s: sandboxed = %v, want %v (%q)", tc.path, sandboxed, tc.sandbox, h.Values("Content-Security-Policy"))
		}
		if h.Get("X-Preview-Markup") != "html" {
			t.Errorf("%s: an allowed header was dropped", tc.path)
		}
	}
	for _, r := range f.requests() {
		if r.Header.Get("Cookie") != "" {
			t.Errorf("the member's instance was sent cookies: %q", r.Header.Get("Cookie"))
		}
		if r.Header.Get("Authorization") != "Bearer gateway-bearer-li" {
			t.Errorf("the member's instance got Authorization %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Origin") != "" || r.Header.Get("Referer") != "" {
			t.Errorf("Origin/Referer reached the member's instance: %q %q", r.Header.Get("Origin"), r.Header.Get("Referer"))
		}
		if r.Header.Get("X-Forwarded-For") == "" {
			t.Error("no X-Forwarded-For: the instance would audit 127.0.0.1")
		}
	}
}

// The interface is the gateway's own, whoever is signed in. The member's
// instance is never asked for a document or a script.
func TestAMemberIsServedTheGatewaysOwnInterface(t *testing.T) {
	ts, _ := newTestServer(t)
	f := newFakeInstance(t)
	c, _ := addMember(t, ts, "li", f)
	for _, p := range []string{"/", "/projects", "/assets/index-x.js", "/sw.js", "/share/x", "/page-admin/x/", "/plugin/x/a.js"} {
		res, body := memberDo(t, c, http.MethodGet, ts.URL+p)
		if strings.Contains(body, memberMarker) {
			t.Errorf("%s with a member's cookie came from the member's instance (%d)", p, res.StatusCode)
		}
	}
	if n := len(f.requests()); n != 0 {
		t.Errorf("the member's instance was asked %d times for non-API paths", n)
	}
}

func TestEachMemberReachesTheirOwnInstance(t *testing.T) {
	ts, _ := newTestServer(t)
	fa, fb := newFakeInstance(t), newFakeInstance(t)
	ca, _ := addMember(t, ts, "alice", fa)
	cb, _ := addMember(t, ts, "bob", fb)
	memberDo(t, ca, http.MethodGet, ts.URL+"/api/state")
	memberDo(t, ca, http.MethodGet, ts.URL+"/api/state")
	memberDo(t, cb, http.MethodGet, ts.URL+"/api/state")
	for name, f := range map[string]*fakeInstance{"alice": fa, "bob": fb} {
		for _, r := range f.requests() {
			if r.Header.Get("Authorization") != "Bearer gateway-bearer-"+name {
				t.Errorf("%s's instance got %q", name, r.Header.Get("Authorization"))
			}
		}
	}
	if len(fa.requests()) != 2 || len(fb.requests()) != 1 {
		t.Errorf("alice's instance saw %d, bob's %d; want 2 and 1", len(fa.requests()), len(fb.requests()))
	}
}

// One form for both, and one answer for a wrong password, an unknown name and
// a disabled member.
func TestMemberSignInAndOut(t *testing.T) {
	ts, srv := newTestServer(t)
	f := newFakeInstance(t)
	c, id := addMember(t, ts, "li", f)
	login := func(name, pw string) (int, string) {
		// The throttle is shared, which is the point, and would answer the
		// second attempt with 429 before either lookup ran.
		srv.Auth.Throttle = auth.NewThrottle()
		res, err := anonymousClient(t).Post(ts.URL+"/api/auth/login", "application/json",
			strings.NewReader(fmt.Sprintf(`{"username":%q,"password":%q}`, name, pw)))
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, string(b)
	}
	wrongCode, wrong := login("li", "not the password at all")
	unknownCode, unknown := login("nobody-at-all", "not the password at all")
	if wrongCode != http.StatusUnauthorized || unknownCode != http.StatusUnauthorized || wrong != unknown {
		t.Errorf("wrong member password %d %q, unknown name %d %q", wrongCode, wrong, unknownCode, unknown)
	}

	if _, body := memberDo(t, c, http.MethodGet, ts.URL+"/api/auth/state"); !strings.Contains(body, `"member":true`) || !strings.Contains(body, `"username":"li"`) {
		t.Errorf("auth state for a member: %s", body)
	}
	req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/api/members/"+id, strings.NewReader(`{"disabled":true}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := ts.Client().Do(req)
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("disable: %v %v", err, res.Status)
	}
	res.Body.Close()
	if res, _ := memberDo(t, c, http.MethodGet, ts.URL+"/api/state"); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("a disabled member's cookie on /api/state = %d", res.StatusCode)
	}
	if code, body := login("li", memberPassword); code != http.StatusUnauthorized || body != unknown {
		t.Errorf("a disabled member signing in: %d %q", code, body)
	}
}

// The owner sees a member through these reads, each to one fixed path on the
// member's instance. Adding one is the decision; this list is where it is made.
func TestOwnerReadsOfAMemberAreTheseRoutes(t *testing.T) {
	ts, srv := newTestServer(t)
	want := []string{
		"DELETE /api/members/{id}",
		"GET /api/members",
		"GET /api/members/{id}/home",
		"GET /api/members/{id}/home/projects/{pid}",
		"GET /api/members/{id}/state",
		"PATCH /api/members/{id}",
		"POST /api/members",
	}
	var got []string
	if err := chi.Walk(srv.Routes().(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, "/api/members") {
			got = append(got, method+" "+route)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	if !slices.Equal(got, want) {
		t.Errorf("the owner's member routes are\n  %s\nwant\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}

	f := newFakeInstance(t)
	_, id := addMember(t, ts, "li", f)
	res, err := ts.Client().Get(ts.URL + "/api/members/" + id + "/home/projects/" + url.PathEscape("../../settings"))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	var body struct{ Path string }
	_ = json.Unmarshal(b, &body)
	if res.Header.Get("Content-Type") != "application/json" || !strings.HasPrefix(body.Path, "/api/home/projects/") {
		t.Errorf("an owner read went to %q (%s)", body.Path, res.Header.Get("Content-Type"))
	}
	// A member's instance answering a read with a document is refused, not
	// passed to the owner's page.
	res, err = ts.Client().Get(ts.URL + "/api/members/" + id + "/home")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("owner read of a member's home = %d", res.StatusCode)
	}
}

// A member's open terminal ends when the member is disabled, as the owner's
// do when the owner signs out.
func TestADisabledMemberLosesTheirTerminal(t *testing.T) {
	old := memberWatch
	memberWatch = 50 * time.Millisecond
	t.Cleanup(func() { memberWatch = old })
	ts, _ := newTestServer(t)
	f := newFakeInstance(t)
	c, id := addMember(t, ts, "li", f)
	u, _ := url.Parse(ts.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws",
		&websocket.DialOptions{HTTPClient: c, HTTPHeader: http.Header{"Origin": {"https://elsewhere.example"}}}); err == nil {
		t.Error("a terminal handshake from another site was proxied")
	}
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws",
		&websocket.DialOptions{HTTPClient: c, HTTPHeader: http.Header{"Origin": {u.Scheme + "://" + u.Host}}})
	if err != nil {
		t.Fatalf("dial through the gateway: %v", err)
	}
	defer conn.CloseNow() //nolint:errcheck // test
	if err := conn.Write(ctx, websocket.MessageText, []byte("hello")); err != nil {
		t.Fatal(err)
	}
	if _, b, err := conn.Read(ctx); err != nil || string(b) != "hello" {
		t.Fatalf("echo through the gateway: %q %v", b, err)
	}
	req, _ := http.NewRequest(http.MethodPatch, ts.URL+"/api/members/"+id, strings.NewReader(`{"disabled":true}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	readCtx, readCancel := context.WithTimeout(ctx, 3*time.Second)
	defer readCancel()
	if _, _, err := conn.Read(readCtx); err == nil || readCtx.Err() != nil {
		t.Errorf("the terminal stayed open after the member was disabled: %v", err)
	}
}
