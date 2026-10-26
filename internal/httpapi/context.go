package httpapi

import (
	"context"
	"math"
	"sync"
	"time"

	"github.com/jiangmuran/vibepanel/internal/agentctx"
	"github.com/jiangmuran/vibepanel/internal/chat"
	"github.com/jiangmuran/vibepanel/internal/codexlog"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

const contextEvery = 15 * time.Second

type contextMeter struct {
	// The poller owns discovery and tails; snapshot readers only take mu to
	// copy published values, so a disk read cannot hold up the socket builder.
	entries   map[string]*contextEntry
	watcher   agentctx.Watcher
	claude    agentctx.ClaudeFinder
	now       func() time.Time
	findCodex func(int) string
	mu        sync.Mutex
	values    map[string]agentctx.Usage
}

type contextEntry struct {
	pid     int
	agent   string
	checked time.Time
	path    string
}

func (s *Server) refreshContexts(ctx context.Context, rows []store.Session, panes map[string]tmux.Info) {
	m := &s.contexts
	now := time.Now()
	if m.now != nil {
		now = m.now()
	}
	if m.entries == nil {
		m.entries = map[string]*contextEntry{}
	}
	ids, pids := []string{}, []int{}
	keep := map[string]bool{}
	// Every running session, agent or not, for the limits. A status line
	// reports for whatever session it runs in, and a claude typed into a
	// shell is not one the poller recognises: unbinding by keep dropped such
	// a report on the next tick, two seconds after it arrived.
	running := map[string]bool{}
	for _, row := range rows {
		pane, live := panes[row.TmuxName]
		if live && !pane.Dead && !row.Scratch {
			running[row.ID] = true
		}
		agent := chat.AgentFor(row.LaunchCommand, pane.Command)
		if !live || pane.Dead || pane.PID <= 0 || row.Scratch || (agent != "claude" && agent != "codex") {
			continue
		}
		ids, pids = append(ids, row.ID), append(pids, pane.PID)
		keep[row.ID] = true
		if agent == "claude" {
			// Bound before the 15-second gate: the status line reports the
			// moment a reply lands, and an unbound session would drop it.
			s.quotas.bind(row.ID, claudeAccount(row))
		}
		e := m.entries[row.ID]
		if e == nil || e.pid != pane.PID || e.agent != agent {
			e = &contextEntry{pid: pane.PID, agent: agent}
			m.entries[row.ID] = e
		}
		if !e.checked.IsZero() && now.Sub(e.checked) < contextEvery {
			continue
		}
		e.checked = now
		source := agentctx.Claude
		if agent == "claude" {
			// A hook knows the conversation even when a wrapper hides the pid.
			// A recorded but missing path stays authoritative: guessing another
			// conversation's usage would be worse than displaying nothing.
			tr, ok, err := s.DB.GetSessionTranscript(ctx, row.ID)
			if err == nil && ok && tr.Tool == "claude" && tr.Path != "" {
				e.path = tr.Path
			} else {
				e.path = m.claude.Find(pane.PID)
			}
		} else {
			source = agentctx.Codex
			// Once done, the same pid and rollout need only a stat. Re-resolve
			// while active to notice a new conversation in the same process.
			if e.path == "" || row.State != session.StateDone {
				find := m.findCodex
				if find == nil {
					find = func(pid int) string { return codexlog.FindRollout(codexlog.SystemProc(), pid) }
				}
				e.path = find(pane.PID)
			}
		}
		u, ok := m.watcher.Read(row.ID, e.path, source, now)
		m.publish(row.ID, u, ok)
		// u, not ok: the first token_count of a conversation carries limits
		// and no context yet, and the limits are worth showing on their own.
		if source == agentctx.Codex && e.path != "" && u.Quota != nil {
			account := codexAccount(e.path)
			s.quotas.bind(row.ID, account)
			s.quotas.observe(account, *u.Quota, u.Quota.At)
		}
	}
	m.watcher.Retain(ids)
	m.claude.Retain(pids)
	s.quotas.forget(running)
	for id := range m.entries {
		if !keep[id] {
			delete(m.entries, id)
			m.publish(id, agentctx.Usage{}, false)
		}
	}
}

func (m *contextMeter) publish(id string, u agentctx.Usage, known bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !known {
		delete(m.values, id)
		return
	}
	if m.values == nil {
		m.values = map[string]agentctx.Usage{}
	}
	rounded := u.Used / 1000 * 1000
	if u.Used%1000 >= 500 && rounded <= math.MaxInt64-1000 {
		rounded += 1000
	}
	u.Used = rounded
	old, ok := m.values[id]
	// At describes the published reading, not a heartbeat. Even a new event
	// with the same rounded usage must serialize identically or every viewer
	// receives a whole snapshot again (see notifyState's byte comparison).
	if ok && old.Used == u.Used && old.Window == u.Window && old.Model == u.Model && old.Source == u.Source && old.TurnEnded == u.TurnEnded {
		return
	}
	m.values[id] = u
}

func (m *contextMeter) snapshot(rows []store.Session) map[string]agentctx.Usage {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]agentctx.Usage{}
	for _, row := range rows {
		if u, ok := m.values[row.ID]; ok && !row.Scratch && !row.Exited {
			out[row.ID] = u
		}
	}
	return out
}
