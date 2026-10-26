package httpapi

import (
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jiangmuran/vibepanel/internal/agentctx"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/webui"
)

// quotaMeter holds what each account has used of its subscription.
//
// Per account and not per session, because that is what a limit is: three
// Claude sessions on one login share one five-hour window, and a session that
// has been idle since this morning would otherwise show this morning's figure
// beside one that answered a minute ago. Each session is bound to its account,
// and the snapshot gives every session its account's freshest reading.
//
// Two producers: the poller, which finds a Codex session's limits in the
// rollout it already tails for context, and the Claude status line, which
// arrives through the hook endpoint. Neither may wait on the other, so both
// only take mu to copy a value in.
type quotaMeter struct {
	mu       sync.Mutex
	accounts map[string]quotaReading
	sessions map[string]string
}

type quotaReading struct {
	quota agentctx.Quota
	// seen is when the agent produced the reading, which decides which of two
	// sessions on one account is the fresher. Not quota.At: that changes only
	// when the figures do, so that an unchanged reading serialises the same.
	seen time.Time
}

// claudeAccount is the key a Claude session's limits are kept under. The
// account id is the panel's own (claude_accounts), and "" is the login in
// ~/.claude, which is an account like any other.
func claudeAccount(row store.Session) string {
	return "claude:" + row.ClaudeAccountID
}

// codexAccount is the CODEX_HOME a rollout was written under, which is the
// login: rollouts live at <home>/sessions/YYYY/MM/DD/. A path not of that
// shape is keyed by itself, which costs sharing and never mixes two logins.
func codexAccount(rollout string) string {
	if i := strings.LastIndex(rollout, string(filepath.Separator)+"sessions"+string(filepath.Separator)); i > 0 {
		return "codex:" + rollout[:i]
	}
	return "codex:" + rollout
}

// bind says which account a session's limits are read from.
func (m *quotaMeter) bind(sessionID, account string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions == nil {
		m.sessions = map[string]string{}
	}
	m.sessions[sessionID] = account
}

// observe records a reading and reports whether what a viewer would be sent
// changed. An older reading than the one held is dropped: the poller reads
// every Codex session in turn, and the last one read is not the last one
// written.
func (m *quotaMeter) observe(account string, q agentctx.Quota, seen time.Time) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.accounts == nil {
		m.accounts = map[string]quotaReading{}
	}
	old, ok := m.accounts[account]
	if ok && seen.Before(old.seen) {
		return false
	}
	if ok && old.quota.Same(q) {
		old.seen = seen
		m.accounts[account] = old
		return false
	}
	m.accounts[account] = quotaReading{quota: q, seen: seen}
	return true
}

// forget unbinds the sessions that are no longer running. Accounts are kept:
// there are a handful, and a reading outlives the session that took it, which
// is what lets the next session on that login show it before its first reply.
func (m *quotaMeter) forget(keep map[string]bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id := range m.sessions {
		if !keep[id] {
			delete(m.sessions, id)
		}
	}
}

func (m *quotaMeter) snapshot(rows []store.Session) map[string]agentctx.Quota {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]agentctx.Quota{}
	for _, row := range rows {
		if row.Scratch || row.Exited {
			continue
		}
		if r, ok := m.accounts[m.sessions[row.ID]]; ok {
			out[row.ID] = r.quota
		}
	}
	return out
}

// bundle is the embedded frontend's name for the snapshot, or "" when the
// frontend comes from disk: there it is rebuilt under a running panel on
// purpose, and the embedded name would describe a build nobody is served.
func (s *Server) bundle() string {
	if s.Cfg.StaticDir != "" {
		return ""
	}
	return webui.Entry()
}
