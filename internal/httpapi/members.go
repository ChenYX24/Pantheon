package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/jiangmuran/vibepanel/internal/auth"
	"github.com/jiangmuran/vibepanel/internal/id"
	"github.com/jiangmuran/vibepanel/internal/store"
)

// The front door: members behind the owner's panel, on the owner's address.
// docs/pantheon/stage-m-contract.md is the design; the shape of it is:
//
//   - A member is a Linux account with a panel instance of their own. Here
//     they are a row in members, which currentUser never reads, so a member's
//     cookie is an unknown string to every owner route (red line 8's shape).
//   - With a member's cookie, /api/* and /ws are proxied to the member's
//     instance with the gateway's bearer for it. Everything else -- the
//     interface, its scripts, the service worker -- is this panel's own
//     embedded files, whoever is signed in.
//   - The member's instance is code the member controls, on this origin. So
//     what comes back is data: response headers are an allowlist, no cookie
//     is ever passed in either direction, and anything a browser could run
//     as a document gets a CSP sandbox, which puts it on an opaque origin.

const memberCookieName = "vp_member"

func (s *Server) memberCookieName() string {
	return auth.CookieNameAt(memberCookieName, s.Cfg.BasePath)
}

func (s *Server) setMemberCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     s.memberCookieName(),
		Value:    token,
		Path:     s.Cfg.BasePath + "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   s.cookieSecureFor(r),
		Expires:  time.Now().Add(auth.SessionTTL),
		MaxAge:   int(auth.SessionTTL / time.Second),
	})
}

func (s *Server) clearMemberCookie(w http.ResponseWriter, r *http.Request) {
	if _, err := r.Cookie(s.memberCookieName()); err != nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     s.memberCookieName(),
		Value:    "",
		Path:     s.Cfg.BasePath + "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   s.cookieSecureFor(r),
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}

// signedInMember is the member a request's cookie names, if it names a live
// session of an enabled member.
func (s *Server) signedInMember(r *http.Request) (store.Member, []byte, bool, error) {
	c, err := r.Cookie(s.memberCookieName())
	if err != nil || c.Value == "" {
		return store.Member{}, nil, false, nil
	}
	hash := auth.HashToken(c.Value)
	m, err := s.DB.MemberBySession(r.Context(), hash)
	if errors.Is(err, store.ErrNotFound) {
		return store.Member{}, nil, false, nil
	}
	if err != nil {
		return store.Member{}, nil, false, err
	}
	return m, hash, true, nil
}

// memberRefused are the API paths a member's cookie never reaches, on the
// member's instance or here. Each serves or administers something that is
// HTML or code on this origin (share pages, admin pages, plugins, previews),
// or is a door for a process and not a browser (hooks, me, the chat bridge),
// or is a credential bound to this origin (passkeys). A member gets them
// later, each on an origin of its own, or not at all.
var memberRefused = []string{
	// "/api/plugin" as a bare prefix: /api/plugin/, /api/plugin-hook/ and
	// /api/plugin-http/ are three surfaces, and the third was missed once.
	"/api/share/", "/api/page-admin/", "/api/plugin",
	"/api/settings/plugin", "/api/settings/pages", "/api/settings/shares", "/api/settings/previews",
	"/api/me/", "/api/me", "/api/hook/", "/api/chat/hooks/", "/api/chat/tools/",
	"/api/auth/", "/api/update",
	// Member management is the owner's. With a member's cookie it would reach
	// the member's own instance, which has no members and no root, and the
	// answer would only confuse.
	"/api/members",
}

func memberRefusedPath(p string) bool {
	for _, prefix := range memberRefused {
		if p == strings.TrimSuffix(prefix, "/") || strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}

// gatedRouter is the router with the gate in front of it. Still a chi.Router,
// so chi.Walk sees every route: the tests that pin which routes a credential
// reaches walk this, and a plain http.Handler here would hide them all.
type gatedRouter struct {
	chi.Router
	gate http.Handler
}

func (g gatedRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) { g.gate.ServeHTTP(w, r) }

// memberGate wraps the whole router. A request without a live member cookie
// goes to the owner's routes exactly as before, which is most of what makes
// this safe: the owner's side of the panel is not told members exist.
func (s *Server) memberGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/") && p != "/ws" {
			next.ServeHTTP(w, r)
			return
		}
		m, hash, ok, err := s.signedInMember(r)
		if err != nil {
			s.noteStale(err)
			writeErr(w, http.StatusServiceUnavailable, "the panel cannot reach its own database; your sessions are unaffected")
			return
		}
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		switch p {
		case "/api/health", "/api/auth/login":
			next.ServeHTTP(w, r)
			return
		case "/api/auth/state":
			writeJSON(w, http.StatusOK, authState{Configured: true, Authenticated: true, Username: m.Username, Member: true})
			return
		case "/api/auth/logout":
			s.memberLogout(w, r, hash)
			return
		case "/api/auth/password":
			s.memberChangePassword(w, r, m)
			return
		}
		if memberRefusedPath(p) {
			writeErr(w, http.StatusNotFound, "not available to members")
			return
		}
		if s.refuseBlockedWrite(r.Context(), w, r) {
			return
		}
		if p == "/ws" && !s.sameSiteHandshake(r) {
			writeErr(w, http.StatusForbidden, "a terminal connection from another site")
			return
		}
		s.proxyToMember(w, r, m, hash)
	})
}

// sameSiteHandshake is the WebSocket origin check, done here because the
// member's instance cannot do it: the gateway strips Origin before
// forwarding, and the instance only ever sees the gateway.
func (s *Server) sameSiteHandshake(r *http.Request) bool {
	origin := strings.TrimSuffix(r.Header.Get("Origin"), "/")
	if origin == "" || origin == "null" {
		return false
	}
	if from := hostOfOrigin(origin); from != "" && sameOrigin(from, r.Host) {
		return true
	}
	for _, a := range s.publicOrigins(r) {
		if sameOrigin(origin, a) {
			return true
		}
	}
	return false
}

// The request headers a member's instance is sent. Cookies above all: a
// browser signed in as the owner too would otherwise hand the owner's session
// to code the member controls.
var memberRequestHeaders = map[string]bool{
	"Accept": true, "Accept-Encoding": true, "Accept-Language": true,
	"Cache-Control": true, "Content-Type": true, "Content-Length": true,
	"If-Match": true, "If-None-Match": true, "If-Modified-Since": true, "Range": true,
	"User-Agent": true,
	"Upgrade":    true, "Connection": true,
	"Sec-Websocket-Key": true, "Sec-Websocket-Version": true,
	"Sec-Websocket-Protocol": true, "Sec-Websocket-Extensions": true,
}

// The response headers a member's instance may set. An allowlist, because
// the dangerous ones are the ones nobody thinks of: Set-Cookie (overwrite
// the owner's session), Clear-Site-Data (sign the owner out of everything),
// Location, Refresh, Link, Service-Worker-Allowed.
var memberResponseHeaders = map[string]bool{
	"Content-Type": true, "Content-Length": true, "Content-Encoding": true,
	"Content-Disposition": true, "Content-Range": true, "Accept-Ranges": true,
	"Cache-Control": true, "Etag": true, "Last-Modified": true, "Vary": true,
	"Retry-After": true, "Content-Security-Policy": true,
	"X-Preview-Kind": true, "X-Preview-Markup": true, "X-Preview-Truncated": true, "X-Preview-Type": true,
	"X-Ratelimit-Remaining": true, "X-Ratelimit-Reset": true,
	"Upgrade": true, "Connection": true,
	"Sec-Websocket-Accept": true, "Sec-Websocket-Protocol": true, "Sec-Websocket-Extensions": true,
}

// memberSandbox is added to anything a browser could run as a document. A
// second Content-Security-Policy only narrows: whatever the instance sent
// stays, and cannot widen this one. Without allow-same-origin the document is
// on an opaque origin -- no cookies of this origin, and every write it makes
// says Origin: null, which crossOriginWrite refuses.
const memberSandbox = "sandbox allow-scripts allow-downloads"

func runnableType(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
	switch {
	case ct == "", ct == "text/html", ct == "application/xhtml+xml", ct == "image/svg+xml",
		ct == "text/xml", ct == "application/xml", strings.HasSuffix(ct, "+xml"):
		return true
	}
	return false
}

func memberModifyResponse(res *http.Response) error {
	for k := range res.Header {
		if !memberResponseHeaders[http.CanonicalHeaderKey(k)] {
			res.Header.Del(k)
		}
	}
	ct := res.Header.Get("Content-Type")
	if l := strings.ToLower(ct); strings.Contains(l, "javascript") || strings.Contains(l, "ecmascript") {
		res.Header.Set("Content-Type", "application/octet-stream")
	}
	if res.StatusCode != http.StatusSwitchingProtocols && runnableType(ct) {
		res.Header.Add("Content-Security-Policy", memberSandbox)
	}
	res.Header.Set("X-Content-Type-Options", "nosniff")
	res.Header.Set("Referrer-Policy", "no-referrer")
	return nil
}

// memberWatch is how often a member's open terminal is re-checked: the
// owner's sockets are, through stillAuthorized, and a member who is disabled
// or signs out must not keep a live terminal for hours either.
var memberWatch = 30 * time.Second

func (s *Server) proxyToMember(w http.ResponseWriter, r *http.Request, m store.Member, sessionHash []byte) {
	token, ok, err := s.DB.MemberToken(r.Context(), m.ID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if !ok {
		writeErr(w, http.StatusBadGateway, "the panel has no working credential for "+m.Username+"'s own panel; the owner can set it again")
		return
	}
	if err := store.ValidUpstream(m.Upstream); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	target := &url.URL{Scheme: "http", Host: m.Upstream}
	client := s.clientIP(r)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	if r.URL.Path == "/ws" {
		// httputil closes an upgraded connection when the request's context
		// ends, which is what makes this a revocation and not a log line.
		go func() {
			t := time.NewTicker(memberWatch)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					if _, err := s.DB.MemberBySession(context.Background(), sessionHash); errors.Is(err, store.ErrNotFound) || !s.addressAllowed(r) {
						cancel()
						return
					}
				}
			}
		}()
	}
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			for k := range pr.Out.Header {
				if !memberRequestHeaders[http.CanonicalHeaderKey(k)] {
					pr.Out.Header.Del(k)
				}
			}
			pr.Out.Header.Set("Authorization", "Bearer "+token)
			// The instance believes this only from the gateway, which is the
			// only thing that can reach it (VIBEPANEL_TRUSTED_PROXIES), so its
			// throttle and its audit log record the person and not 127.0.0.1.
			pr.Out.Header.Set("X-Forwarded-For", client)
		},
		ModifyResponse: memberModifyResponse,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			s.Log.Warn("member instance unreachable", "member", m.Username, "err", err)
			writeErr(w, http.StatusBadGateway, m.Username+"'s panel is not answering; the owner can restart it")
		},
		FlushInterval: -1,
	}
	rp.ServeHTTP(w, r.WithContext(ctx))
}

// memberLogin is handleLogin's second lookup: users first, members after.
// One form, one throttle, the same answer for an unknown name and a wrong
// password. handled is false only when the name is nobody's.
func (s *Server) memberLogin(w http.ResponseWriter, r *http.Request, username, password, ip string) (handled bool) {
	ctx := r.Context()
	m, err := s.DB.MemberByName(ctx, username)
	if err != nil {
		return false
	}
	ok, verr := auth.VerifyPassword(password, m.PasswordHash)
	if verr != nil {
		s.Log.Warn("password verify", "err", verr)
	}
	if !ok || m.Disabled {
		why := "wrong password"
		if m.Disabled {
			why = "member disabled"
		}
		s.auditLoginFailure(ctx, username, ip, why)
		writeErrCode(w, http.StatusUnauthorized, CodeBadCredentials, "wrong username or password")
		return true
	}
	if s.Auth != nil {
		s.Auth.Throttle.Succeed(ip)
	}
	if !s.issueMemberSession(w, r, m) {
		return true
	}
	s.audit(ctx, "login", m.Username, ip, "member")
	writeJSON(w, http.StatusOK, authState{Configured: true, Authenticated: true, Username: m.Username, Member: true})
	return true
}

func (s *Server) issueMemberSession(w http.ResponseWriter, r *http.Request, m store.Member) bool {
	token, err := auth.NewToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create a session")
		return false
	}
	if err := s.DB.CreateMemberSession(r.Context(), auth.HashToken(token), m.ID, auth.SessionTTL, r.UserAgent(), s.clientIP(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create a session")
		return false
	}
	// One identity per browser: a member signing in here signs the owner's
	// session in this browser out, and issueSession does the reverse. With
	// both cookies the gate would pick the member, which is safe and confusing.
	auth.ClearCookieAt(w, s.cookieSecureFor(r), s.Cfg.BasePath)
	s.setMemberCookie(w, r, token)
	return true
}

func (s *Server) memberLogout(w http.ResponseWriter, r *http.Request, hash []byte) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST")
		return
	}
	if s.refuseBlockedWrite(r.Context(), w, r) {
		return
	}
	if err := s.DB.DeleteMemberSession(r.Context(), hash); err != nil {
		s.Log.Warn("delete member session", "err", err)
	}
	s.clearMemberCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) memberChangePassword(w http.ResponseWriter, r *http.Request, m store.Member) {
	ctx := r.Context()
	ip := s.clientIP(r)
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST")
		return
	}
	if s.refuseBlockedWrite(ctx, w, r) {
		return
	}
	if s.Auth != nil {
		if wait, blocked := s.Auth.Throttle.Delay(ip, time.Now()); blocked {
			writeThrottled(w, wait)
			return
		}
	}
	var req changePasswordRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "malformed request")
		return
	}
	if !acquirePasswordSlot(ctx) {
		writeErrCode(w, http.StatusServiceUnavailable, CodeBusy, "the panel is busy; try again")
		return
	}
	defer releasePasswordSlot()
	if ok, err := auth.VerifyPassword(req.Current, m.PasswordHash); err != nil || !ok {
		if s.Auth != nil {
			s.Auth.Throttle.Fail(ip, time.Now())
		}
		s.audit(ctx, "password.change_refused", m.Username, ip, "member; current password did not match")
		writeErrCode(w, http.StatusUnauthorized, CodeWrongCurrentPassword, "the current password is wrong")
		return
	}
	if err := validateCredentials(m.Username, req.Next); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Next == req.Current {
		writeErrCode(w, http.StatusBadRequest, CodeSamePassword, "the new password is the same as the old one")
		return
	}
	hash, err := auth.HashPassword(req.Next)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not hash the password")
		return
	}
	if err := s.DB.SetMemberPassword(ctx, m.ID, hash); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if err := s.DB.DeleteMemberSessions(ctx, m.ID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if !s.issueMemberSession(w, r, m) {
		return
	}
	s.audit(ctx, "password.changed", m.Username, ip, "member")
	w.WriteHeader(http.StatusNoContent)
}

// ─── the owner's side ─────────────────────────────────────────────────────

// registerMemberRoutes are owner routes: below RequireAuth, where a member's
// cookie is already a 401.
func (s *Server) registerMemberRoutes(r chi.Router) {
	r.Get("/members", s.handleListMembers)
	r.Post("/members", s.handleCreateMember)
	// The Members page's root half, through pantheon-member (memberOp).
	r.Get("/members/system", s.handleMemberSystem)
	r.Post("/members/provision", s.handleProvisionMember)
	r.Post("/members/{id}/claude", s.handleMemberOp("grant-claude", "token", "claude granted"))
	r.Delete("/members/{id}/claude", s.handleMemberOp("revoke-claude", "", "claude revoked"))
	r.Post("/members/{id}/restart", s.handleMemberOp("restart", "", "restarted"))
	r.Post("/members/{id}/remove", s.handleMemberOp("remove", "", ""))
	r.Patch("/members/{id}", s.handlePatchMember)
	r.Delete("/members/{id}", s.handleDeleteMember)
	// The owner looking at a member: named reads with fixed upstream paths,
	// so what the owner can see of a member is this list and nothing a
	// request can widen. TestOwnerReadsOfAMemberAreTheseRoutes pins it.
	for route, upstream := range memberReads {
		r.Get("/members/{id}"+route, s.handleMemberRead(upstream))
	}
}

// memberReads maps an owner route under /api/members/{id} to the member
// instance's route it reads. {pid} is copied across, path-escaped.
var memberReads = map[string]string{
	"/home":                "/api/home",
	"/home/projects/{pid}": "/api/home/projects/{pid}",
	"/state":               "/api/state",
}

type memberView struct {
	store.Member
	Healthy bool   `json:"healthy"`
	Version string `json:"version,omitempty"`
}

var memberHTTP = &http.Client{
	Timeout: 5 * time.Second,
	// A member instance redirecting the owner's server-side read is not
	// something to follow anywhere.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	list, err := s.DB.ListMembers(r.Context())
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]memberView, len(list))
	var wg sync.WaitGroup
	for i, m := range list {
		out[i] = memberView{Member: m}
		wg.Add(1)
		go func(v *memberView) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+v.Upstream+"/api/health", nil)
			if err != nil {
				return
			}
			res, err := memberHTTP.Do(req)
			if err != nil {
				return
			}
			defer res.Body.Close() //nolint:errcheck // read-only
			var h struct {
				OK      bool   `json:"ok"`
				Version string `json:"version"`
			}
			if res.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&h) == nil {
				v.Healthy, v.Version = h.OK, h.Version
			}
		}(&out[i])
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"members": out})
}

type createMemberRequest struct {
	Username  string `json:"username"`
	Password  string `json:"password"`
	LinuxUser string `json:"linuxUser"`
	Upstream  string `json:"upstream"`
	Token     string `json:"token"`
}

func (s *Server) handleCreateMember(w http.ResponseWriter, r *http.Request) {
	var req createMemberRequest
	if !decode(w, r, &req) {
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if err := validateCredentials(req.Username, req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.LinuxUser == "" || req.Token == "" {
		writeErr(w, http.StatusBadRequest, "linuxUser and token are required")
		return
	}
	if err := store.ValidUpstream(req.Upstream); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not hash the password")
		return
	}
	m, err := s.DB.CreateMember(r.Context(), store.Member{
		ID: id.New(), Username: req.Username, PasswordHash: hash,
		LinuxUser: req.LinuxUser, Upstream: req.Upstream,
	}, req.Token)
	if errors.Is(err, store.ErrNameTaken) {
		writeErr(w, http.StatusConflict, "that name is already somebody's")
		return
	}
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if u, ok := currentUserFrom(r); ok {
		s.audit(r.Context(), "member.created", u.Username, s.clientIP(r), m.Username+" -> "+m.Upstream)
	}
	writeJSON(w, http.StatusCreated, m)
}

type patchMemberRequest struct {
	Disabled *bool   `json:"disabled"`
	Password *string `json:"password"`
	Token    *string `json:"token"`
}

func (s *Server) handlePatchMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	m, err := s.DB.MemberByID(ctx, chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	var req patchMemberRequest
	if !decode(w, r, &req) {
		return
	}
	var did []string
	if req.Password != nil {
		if err := validateCredentials(m.Username, *req.Password); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := auth.HashPassword(*req.Password)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not hash the password")
			return
		}
		if err := s.DB.SetMemberPassword(ctx, m.ID, hash); err != nil {
			s.writeStoreErr(w, err)
			return
		}
		if err := s.DB.DeleteMemberSessions(ctx, m.ID); err != nil {
			s.writeStoreErr(w, err)
			return
		}
		did = append(did, "password")
	}
	if req.Token != nil {
		if *req.Token == "" {
			writeErr(w, http.StatusBadRequest, "an empty token would lock the member out")
			return
		}
		if err := s.DB.SetMemberToken(ctx, m.ID, *req.Token); err != nil {
			s.writeStoreErr(w, err)
			return
		}
		did = append(did, "token")
	}
	if req.Disabled != nil {
		if err := s.DB.SetMemberDisabled(ctx, m.ID, *req.Disabled); err != nil {
			s.writeStoreErr(w, err)
			return
		}
		if *req.Disabled {
			did = append(did, "disabled")
		} else {
			did = append(did, "enabled")
		}
	}
	if u, ok := currentUserFrom(r); ok && len(did) > 0 {
		s.audit(ctx, "member.changed", u.Username, s.clientIP(r), m.Username+": "+strings.Join(did, ", "))
	}
	m, err = s.DB.MemberByID(ctx, m.ID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) handleDeleteMember(w http.ResponseWriter, r *http.Request) {
	m, err := s.DB.MemberByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if err := s.DB.DeleteMember(r.Context(), m.ID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if u, ok := currentUserFrom(r); ok {
		s.audit(r.Context(), "member.removed", u.Username, s.clientIP(r), m.Username)
	}
	w.WriteHeader(http.StatusNoContent)
}

// memberReadLimit bounds what the owner's panel buffers from a member's
// instance for one read.
const memberReadLimit = 8 << 20

func (s *Server) handleMemberRead(upstream string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		m, err := s.DB.MemberByID(ctx, chi.URLParam(r, "id"))
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		token, ok, err := s.DB.MemberToken(ctx, m.ID)
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		if !ok {
			writeErr(w, http.StatusBadGateway, "no working credential for "+m.Username+"'s panel")
			return
		}
		path := strings.Replace(upstream, "{pid}", url.PathEscape(chi.URLParam(r, "pid")), 1)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+m.Upstream+path, nil)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		res, err := memberHTTP.Do(req)
		if err != nil {
			writeErr(w, http.StatusBadGateway, m.Username+"'s panel is not answering")
			return
		}
		defer res.Body.Close() //nolint:errcheck // read-only
		body, err := io.ReadAll(io.LimitReader(res.Body, memberReadLimit+1))
		if err != nil || len(body) > memberReadLimit {
			writeErr(w, http.StatusBadGateway, "the answer from "+m.Username+"'s panel was too large or cut short")
			return
		}
		// JSON or nothing: this reaches the owner's own page, signed in as
		// the owner, and is drawn by the owner's interface.
		if !json.Valid(body) {
			writeErr(w, http.StatusBadGateway, "the answer from "+m.Username+"'s panel was not JSON")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(res.StatusCode)
		_, _ = w.Write(body)
	}
}

// ─── the root half ────────────────────────────────────────────────────────

// Creating a member makes a Linux account, and granting Claude writes a file
// only root reads, so the Members page does them through one fixed command,
// pantheon-member, under `sudo -n`. That widens nothing: whoever is signed in
// here as the owner already has a terminal as the panel's Linux user, and the
// command is what that terminal would run. What it does constrain is the
// shape: a fixed verb, a name that matched memberName, and secrets on stdin
// (never argv, which every account on the machine can read).
var memberName = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,30}$`)

const memberCommandPath = "/usr/local/sbin/pantheon-member"

// memberOpLimit bounds what is kept of the command's output: it is shown on
// the page when something fails, and the last lines are the ones that say why.
const memberOpLimit = 16 << 10

func (s *Server) memberOp(ctx context.Context, timeout time.Duration, stdin string, args ...string) (string, error) {
	argv := s.memberCmd
	if len(argv) == 0 {
		argv = []string{"sudo", "-n", "--", memberCommandPath}
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, argv[0], append(append([]string{}, argv[1:]...), args...)...) //nolint:gosec // fixed argv, validated name
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin + "\n")
	}
	out, err := cmd.CombinedOutput()
	text := string(out)
	if len(text) > memberOpLimit {
		text = text[len(text)-memberOpLimit:]
	}
	if ctx.Err() == context.DeadlineExceeded {
		return text, errors.New("pantheon-member did not finish in time")
	}
	return strings.TrimSpace(text), err
}

type memberSystem struct {
	// Available is whether the panel can run pantheon-member. When it cannot,
	// the page says what to run on the server instead of offering buttons
	// that would fail.
	Available bool                        `json:"available"`
	Reason    string                      `json:"reason,omitempty"`
	Members   map[string]memberSystemFact `json:"members"`
}

type memberSystemFact struct {
	Unit          string `json:"unit"`
	MemoryCurrent int64  `json:"memoryCurrent"`
	MemoryMax     int64  `json:"memoryMax"`
	Claude        bool   `json:"claude"`
}

func (s *Server) handleMemberSystem(w http.ResponseWriter, r *http.Request) {
	out, err := s.memberOp(r.Context(), 20*time.Second, "", "status", "--json")
	if err != nil {
		writeJSON(w, http.StatusOK, memberSystem{Reason: lastLine(out, err), Members: map[string]memberSystemFact{}})
		return
	}
	var sys memberSystem
	if jerr := json.Unmarshal([]byte(out), &sys); jerr != nil {
		writeJSON(w, http.StatusOK, memberSystem{Reason: "pantheon-member status said something that is not JSON", Members: map[string]memberSystemFact{}})
		return
	}
	sys.Available = true
	if sys.Members == nil {
		sys.Members = map[string]memberSystemFact{}
	}
	writeJSON(w, http.StatusOK, sys)
}

func lastLine(out string, err error) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if l := strings.TrimSpace(lines[len(lines)-1]); l != "" {
		return l
	}
	return err.Error()
}

type memberOpResult struct {
	Output string        `json:"output"`
	Member *store.Member `json:"member,omitempty"`
}

func (s *Server) handleProvisionMember(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !memberName.MatchString(req.Username) {
		writeErr(w, http.StatusBadRequest, "a member name is 2–31 lowercase letters, digits, - and _, starting with a letter")
		return
	}
	if err := validateCredentials(req.Username, req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.DB.UserByName(r.Context(), req.Username); err == nil {
		writeErr(w, http.StatusConflict, "that name is the owner's")
		return
	}
	// Copying the owner's claude and codex is most of the time this takes.
	out, err := s.memberOp(r.Context(), 10*time.Minute, req.Password, "add", req.Username)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": lastLine(out, err), "output": out})
		return
	}
	res := memberOpResult{Output: out}
	if m, err := s.DB.MemberByName(r.Context(), req.Username); err == nil {
		res.Member = &m
	}
	writeJSON(w, http.StatusOK, res)
}

// handleMemberOp runs one pantheon-member verb for a member. field names the
// request's JSON string that goes to stdin, if any.
func (s *Server) handleMemberOp(verb, field, audited string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		m, err := s.DB.MemberByID(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		if !memberName.MatchString(m.LinuxUser) {
			writeErr(w, http.StatusConflict, "this member's Linux account name cannot be passed to pantheon-member")
			return
		}
		stdin := ""
		if field != "" {
			var req map[string]string
			if !decode(w, r, &req) {
				return
			}
			if stdin = strings.TrimSpace(req[field]); stdin == "" || strings.ContainsAny(stdin, "\r\n") {
				writeErr(w, http.StatusBadRequest, field+" is required, on one line")
				return
			}
		}
		out, err := s.memberOp(r.Context(), 2*time.Minute, stdin, verb, m.LinuxUser)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": lastLine(out, err), "output": out})
			return
		}
		if u, ok := currentUserFrom(r); ok && audited != "" {
			s.audit(r.Context(), "member.changed", u.Username, s.clientIP(r), m.Username+": "+audited)
		}
		writeJSON(w, http.StatusOK, memberOpResult{Output: out})
	}
}
