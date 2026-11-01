package store

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/secret"
)

func TestAMemberNameIsNeverAnOwnersName(t *testing.T) {
	db, ctx := openTemp(t)
	if _, err := db.CreateUser(ctx, "u1", "cyx", "h"); err != nil {
		t.Fatal(err)
	}
	_, err := db.CreateMember(ctx, Member{ID: "m1", Username: "cyx", PasswordHash: "h", LinuxUser: "cyx", Upstream: "127.0.0.2:18450"}, "tok")
	if !errors.Is(err, ErrNameTaken) {
		t.Fatalf("a member named like the owner was created: %v", err)
	}
	if _, err := db.CreateMember(ctx, Member{ID: "m1", Username: "li", PasswordHash: "h", LinuxUser: "li", Upstream: "127.0.0.2:18450"}, "tok"); err != nil {
		t.Fatal(err)
	}
	_, err = db.CreateMember(ctx, Member{ID: "m2", Username: "li", PasswordHash: "h", LinuxUser: "li2", Upstream: "127.0.0.3:18450"}, "tok")
	if !errors.Is(err, ErrNameTaken) {
		t.Fatalf("two members share a name: %v", err)
	}
}

// The gateway proxies a member's terminals to the upstream with a bearer. A
// non-loopback upstream would put both on a network.
func TestAMemberUpstreamIsLoopbackOnly(t *testing.T) {
	db, ctx := openTemp(t)
	for _, up := range []string{"10.0.0.5:18450", "example.com:18450", "127.0.0.2", "", "[::1]"} {
		if _, err := db.CreateMember(ctx, Member{ID: "m" + up, Username: "n" + up, PasswordHash: "h", LinuxUser: "x", Upstream: up}, ""); err == nil {
			t.Errorf("upstream %q was accepted", up)
		}
	}
	for _, up := range []string{"127.0.0.2:18450", "[::1]:18451"} {
		if err := ValidUpstream(up); err != nil {
			t.Errorf("upstream %q was refused: %v", up, err)
		}
	}
}

func TestTheMemberTokenIsSealedAtRest(t *testing.T) {
	dir := t.TempDir()
	if _, err := secret.Open(filepath.Join(dir, secret.KeyFile)); err != nil {
		t.Fatal(err)
	}
	db, err := Open(t.Context(), filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := t.Context()
	if _, err := db.CreateMember(ctx, Member{ID: "m1", Username: "li", PasswordHash: "h", LinuxUser: "li", Upstream: "127.0.0.2:18450"}, "vp_secret_bearer"); err != nil {
		t.Fatal(err)
	}
	var raw string
	if err := db.SQL().QueryRowContext(ctx, `SELECT token FROM members WHERE id = 'm1'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, "vp_secret_bearer") || !strings.HasPrefix(raw, sealedPrefix) {
		t.Fatalf("the bearer is in the database as %q", raw)
	}
	got, ok, err := db.MemberToken(ctx, "m1")
	if err != nil || !ok || got != "vp_secret_bearer" {
		t.Fatalf("MemberToken = %q %v %v", got, ok, err)
	}
	// Moved to another row, a sealed value does not open.
	if _, err := db.CreateMember(ctx, Member{ID: "m2", Username: "z", PasswordHash: "h", LinuxUser: "z", Upstream: "127.0.0.3:18450"}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SQL().ExecContext(ctx, `UPDATE members SET token = ? WHERE id = 'm2'`, raw); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := db.MemberToken(ctx, "m2"); ok {
		t.Fatal("m1's sealed bearer opened as m2's")
	}
}

func TestADisabledMemberHasNoSession(t *testing.T) {
	db, ctx := openTemp(t)
	if _, err := db.CreateMember(ctx, Member{ID: "m1", Username: "li", PasswordHash: "h", LinuxUser: "li", Upstream: "127.0.0.2:18450"}, ""); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateMemberSession(ctx, []byte("tok"), "m1", time.Hour, "ua", "1.2.3.4"); err != nil {
		t.Fatal(err)
	}
	if m, err := db.MemberBySession(ctx, []byte("tok")); err != nil || m.Username != "li" {
		t.Fatalf("MemberBySession = %+v %v", m, err)
	}
	if err := db.SetMemberDisabled(ctx, "m1", true); err != nil {
		t.Fatal(err)
	}
	if _, err := db.MemberBySession(ctx, []byte("tok")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a disabled member is still signed in: %v", err)
	}
	if err := db.SetMemberDisabled(ctx, "m1", false); err != nil {
		t.Fatal(err)
	}
	if _, err := db.MemberBySession(ctx, []byte("tok")); !errors.Is(err, ErrNotFound) {
		t.Fatal("re-enabling a member brought back the session disabling ended")
	}
	if err := db.CreateMemberSession(ctx, []byte("old"), "m1", -time.Second, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.MemberBySession(ctx, []byte("old")); !errors.Is(err, ErrNotFound) {
		t.Fatal("an expired member session is live")
	}
}

// A member is an unknown string to currentUser, which reads users,
// auth_sessions and api_tokens. Pinned here at the bottom: nothing in the
// members tables is reachable through those lookups.
func TestAMemberIsInvisibleToTheOwnerLookups(t *testing.T) {
	db, ctx := openTemp(t)
	if _, err := db.CreateMember(ctx, Member{ID: "m1", Username: "li", PasswordHash: "h", LinuxUser: "li", Upstream: "127.0.0.2:18450"}, "bearer"); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateMemberSession(ctx, []byte("tok"), "m1", time.Hour, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.UserByName(ctx, "li"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UserByName found a member: %v", err)
	}
	if _, err := db.UserByID(ctx, "m1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UserByID found a member: %v", err)
	}
	if _, err := db.AuthSessionByToken(ctx, []byte("tok")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AuthSessionByToken found a member session: %v", err)
	}
	if n, err := db.CountUsers(ctx); err != nil || n != 0 {
		t.Fatalf("CountUsers = %d %v; a member must not make an unconfigured panel look set up", n, err)
	}
}
