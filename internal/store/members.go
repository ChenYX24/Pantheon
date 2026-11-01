package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

// Member is a second person behind the front door: a login here, a Linux
// account and a panel instance of their own (docs/pantheon/stage-m-contract.md).
//
// Not a User, on purpose. currentUser reads users and auth_sessions; a member
// is in neither, so every owner route answers a member's cookie with 401
// without having been told anything about members.
type Member struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	LinuxUser    string `json:"linuxUser"`
	// Upstream is host:port of the member's instance, always a loopback
	// address: the gateway is a reverse proxy to it, and a non-loopback
	// upstream would put a member's terminal traffic, and the gateway's bearer
	// for it, on a network.
	Upstream  string `json:"upstream"`
	Disabled  bool   `json:"disabled"`
	CreatedAt int64  `json:"createdAt"`
}

// ErrNameTaken is a member name that is already an owner's or a member's.
var ErrNameTaken = errors.New("store: that name is taken")

func memberTokenContext(id string) string { return "member-token:" + id }

// ValidUpstream accepts host:port on a loopback address and nothing else.
func ValidUpstream(upstream string) error {
	host, port, err := net.SplitHostPort(upstream)
	if err != nil || port == "" {
		return fmt.Errorf("upstream %q is not host:port", upstream)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("upstream %q is not a loopback address", upstream)
	}
	return nil
}

// CreateMember adds a member. The name must not be an owner's either: login
// looks in users first, so a member sharing an owner's name could never sign
// in, and an owner sharing a member's would shadow them.
func (d *DB) CreateMember(ctx context.Context, m Member, token string) (Member, error) {
	m.Username = strings.TrimSpace(m.Username)
	if err := ValidUpstream(m.Upstream); err != nil {
		return Member{}, err
	}
	if _, err := d.UserByName(ctx, m.Username); err == nil {
		return Member{}, ErrNameTaken
	} else if !errors.Is(err, ErrNotFound) {
		return Member{}, err
	}
	m.CreatedAt = now()
	_, err := d.sql.ExecContext(ctx, `
		INSERT INTO members (id, username, password_hash, linux_user, upstream, token, disabled, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		m.ID, m.Username, m.PasswordHash, m.LinuxUser, m.Upstream,
		d.sealString(token, memberTokenContext(m.ID)), boolInt(m.Disabled), m.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Member{}, ErrNameTaken
		}
		return Member{}, fmt.Errorf("store: create member: %w", err)
	}
	return m, nil
}

const memberColumns = `id, username, password_hash, linux_user, upstream, disabled, created_at`

func scanMember(sc scanner) (Member, error) {
	var m Member
	var disabled int
	if err := sc.Scan(&m.ID, &m.Username, &m.PasswordHash, &m.LinuxUser, &m.Upstream, &disabled, &m.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return Member{}, ErrNotFound
		}
		return Member{}, fmt.Errorf("store: member: %w", err)
	}
	m.Disabled = disabled != 0
	return m, nil
}

// MemberByName finds a member by login name.
func (d *DB) MemberByName(ctx context.Context, username string) (Member, error) {
	return scanMember(d.sql.QueryRowContext(ctx,
		`SELECT `+memberColumns+` FROM members WHERE username = ?`, strings.TrimSpace(username)))
}

// MemberByID finds a member by id.
func (d *DB) MemberByID(ctx context.Context, id string) (Member, error) {
	return scanMember(d.sql.QueryRowContext(ctx, `SELECT `+memberColumns+` FROM members WHERE id = ?`, id))
}

// ListMembers is every member, by name.
func (d *DB) ListMembers(ctx context.Context) ([]Member, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT `+memberColumns+` FROM members ORDER BY username`)
	if err != nil {
		return nil, fmt.Errorf("store: list members: %w", err)
	}
	defer rows.Close() //nolint:errcheck // read-only
	out := []Member{}
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MemberToken is the bearer the gateway presents to the member's instance.
// ok is false when there is none or it does not open with this key.
func (d *DB) MemberToken(ctx context.Context, id string) (string, bool, error) {
	var v string
	err := d.sql.QueryRowContext(ctx, `SELECT token FROM members WHERE id = ?`, id).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, ErrNotFound
	}
	if err != nil {
		return "", false, fmt.Errorf("store: member token: %w", err)
	}
	t, ok := d.openString(v, memberTokenContext(id))
	return t, ok && t != "", nil
}

// SetMemberToken replaces the gateway's bearer for a member's instance.
func (d *DB) SetMemberToken(ctx context.Context, id, token string) error {
	return d.execOne(ctx, `UPDATE members SET token = ? WHERE id = ?`, d.sealString(token, memberTokenContext(id)), id)
}

// SetMemberPassword replaces a member's password hash.
func (d *DB) SetMemberPassword(ctx context.Context, id, hash string) error {
	return d.execOne(ctx, `UPDATE members SET password_hash = ? WHERE id = ?`, hash, id)
}

// SetMemberDisabled turns a member's login off or on. Turning it off also
// ends every session the member has, here: a disabled member who is still
// signed in is not disabled.
func (d *DB) SetMemberDisabled(ctx context.Context, id string, disabled bool) error {
	if err := d.execOne(ctx, `UPDATE members SET disabled = ? WHERE id = ?`, boolInt(disabled), id); err != nil {
		return err
	}
	if disabled {
		if _, err := d.sql.ExecContext(ctx, `DELETE FROM member_sessions WHERE member_id = ?`, id); err != nil {
			return fmt.Errorf("store: end member sessions: %w", err)
		}
	}
	return nil
}

// DeleteMember removes a member's row and sessions. Their Linux account,
// instance and data are not the database's to remove.
func (d *DB) DeleteMember(ctx context.Context, id string) error {
	return d.execOne(ctx, `DELETE FROM members WHERE id = ?`, id)
}

func (d *DB) execOne(ctx context.Context, q string, args ...any) error {
	res, err := d.sql.ExecContext(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("store: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// MemberSession is a signed-in member's browser.
type MemberSession struct {
	MemberID   string
	CreatedAt  int64
	ExpiresAt  int64
	LastSeenAt int64
}

// CreateMemberSession records a member's sign-in.
func (d *DB) CreateMemberSession(ctx context.Context, tokenHash []byte, memberID string, ttl time.Duration, userAgent, ip string) error {
	n := now()
	_, err := d.sql.ExecContext(ctx, `
		INSERT INTO member_sessions (token_hash, member_id, created_at, expires_at, last_seen_at, user_agent, ip)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		tokenHash, memberID, n, time.Now().Add(ttl).Unix(), n, userAgent, ip)
	if err != nil {
		return fmt.Errorf("store: create member session: %w", err)
	}
	return nil
}

// MemberBySession is the member a live session belongs to. An expired
// session, a disabled member and an unknown token are all ErrNotFound.
func (d *DB) MemberBySession(ctx context.Context, tokenHash []byte) (Member, error) {
	return scanMember(d.sql.QueryRowContext(ctx, `
		SELECT m.id, m.username, m.password_hash, m.linux_user, m.upstream, m.disabled, m.created_at
		FROM member_sessions s JOIN members m ON m.id = s.member_id
		WHERE s.token_hash = ? AND s.expires_at > ? AND m.disabled = 0`, tokenHash, now()))
}

// DeleteMemberSession signs one member browser out.
func (d *DB) DeleteMemberSession(ctx context.Context, tokenHash []byte) error {
	_, err := d.sql.ExecContext(ctx, `DELETE FROM member_sessions WHERE token_hash = ?`, tokenHash)
	if err != nil {
		return fmt.Errorf("store: delete member session: %w", err)
	}
	return nil
}

// DeleteMemberSessions signs a member out everywhere, after a password change.
func (d *DB) DeleteMemberSessions(ctx context.Context, memberID string) error {
	_, err := d.sql.ExecContext(ctx, `DELETE FROM member_sessions WHERE member_id = ?`, memberID)
	if err != nil {
		return fmt.Errorf("store: delete member sessions: %w", err)
	}
	return nil
}

// PurgeExpiredMemberSessions drops sessions past their expiry.
func (d *DB) PurgeExpiredMemberSessions(ctx context.Context) (int64, error) {
	res, err := d.sql.ExecContext(ctx, `DELETE FROM member_sessions WHERE expires_at <= ?`, now())
	if err != nil {
		return 0, fmt.Errorf("store: purge member sessions: %w", err)
	}
	return res.RowsAffected()
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
