package resources

import (
	"context"
	"errors"
	"os"
	"syscall"
	"time"

	"github.com/jiangmuran/vibepanel/internal/cgroup"
	"github.com/jiangmuran/vibepanel/internal/sysmon"
)

func (g *Governor) SessionHeld(sessionID string) uint64 {
	m, ok := g.roster().byID[sessionID]
	if !ok {
		return 0
	}
	g.mu.Lock()
	l := g.layout
	g.mu.Unlock()
	if l != nil {
		if leaf, ok := l.Session(m.TmuxName); ok {
			value, _ := held(leaf)
			return value
		}
	}
	table := sysmon.ProcTable()
	procs := func(pid int) (sysmon.Proc, bool) { p, ok := table[pid]; return p, ok }
	pane := g.roster().panes[m.TmuxName].PID
	var total uint64
	for pid, p := range table {
		if pane > 1 && descendsFrom(pid, pane, procs) {
			total += p.RSS
		}
	}
	return total
}

// RolloverEnd gives every process in the pane's groups ten seconds to leave.
// Membership and start times are checked again before escalation: a pane may
// exit during grace, and its pid must never become authority over its successor.
func (g *Governor) RolloverEnd(ctx context.Context, sessionID string) error {
	end, err := g.PrepareRolloverEnd(ctx, sessionID)
	if err != nil {
		return err
	}
	return end(ctx)
}

// PrepareRolloverEnd takes its identities before asking the agent to exit.
// Otherwise an agent that exits voluntarily leaves orphaned children that can
// no longer be proved to belong to its pane on an unisolated development panel.
func (g *Governor) PrepareRolloverEnd(ctx context.Context, sessionID string) (func(context.Context) error, error) {
	ro := g.roster()
	m, ok := ro.byID[sessionID]
	if !ok {
		return nil, ErrUnknownSession
	}
	pane := ro.panes[m.TmuxName].PID
	if pane <= 1 {
		return nil, ErrNotInSession
	}
	server := g.serverPID(ctx)
	if server.PID <= 1 {
		return nil, ErrNotInSession
	}
	g.mu.Lock()
	l := g.layout
	g.mu.Unlock()
	table := sysmon.ProcTable()
	procs := func(pid int) (sysmon.Proc, bool) { p, ok := table[pid]; return p, ok }
	owned := map[int]uint64{}
	groups := map[int]bool{}
	for pid, p := range table {
		if pid == os.Getpid() || pid == server.PID || pid <= 1 {
			continue
		}
		belongs := descendsFrom(pid, pane, procs)
		if l != nil {
			leaf, exists := l.Session(m.TmuxName)
			rel, err := cgroup.Of(pid)
			belongs = exists && err == nil && rel == leaf.Rel()
		}
		if !belongs {
			continue
		}
		pgid, err := syscall.Getpgid(pid)
		if err != nil {
			continue
		}
		if pgid <= 1 {
			return nil, ErrNotInSession
		}
		owned[pid] = p.Start
		groups[pgid] = true
	}
	if _, ok := owned[pane]; !ok {
		return nil, ErrGone
	}
	check := func() ([]int, error) {
		if live := g.roster().panes[m.TmuxName].PID; live != 0 && live != pane {
			return nil, ErrGone
		}
		current := sysmon.ProcTable()
		for pid, p := range current {
			start, tracked := owned[pid]
			if tracked && start != p.Start {
				continue
			}
			if !tracked {
				// A live, previously checked ancestor proves a new child is
				// ours. The cgroup alone could also contain a replacement agent
				// somebody restarted while the old one was writing its handoff.
				belongs := false
				procs := func(pid int) (sysmon.Proc, bool) { p, ok := current[pid]; return p, ok }
				for root, born := range owned {
					if live, ok := current[root]; ok && live.Start == born && descendsFrom(pid, root, procs) {
						belongs = true
						break
					}
				}
				if !belongs || pid <= 1 || pid == os.Getpid() || pid == server.PID {
					continue
				}
				owned[pid] = p.Start
			}
			if group, err := syscall.Getpgid(pid); err == nil && group > 1 {
				groups[group] = true
			}
		}
		active := map[int]bool{}
		for pid, p := range current {
			pgid, err := syscall.Getpgid(pid)
			if err != nil || !groups[pgid] {
				continue
			}
			if pid <= 1 || pid == os.Getpid() || pid == server.PID {
				return nil, ErrNotInSession
			}
			if start, ok := owned[pid]; !ok || start != p.Start {
				return nil, ErrNotInSession
			}
			if l != nil {
				if _, err := g.checkedProcess(sessionID, pid, p.Start, l, ro, LazyProcs()); err != nil {
					return nil, err
				}
			}

			active[pgid] = true
		}
		out := []int{}
		for pgid := range active {
			out = append(out, pgid)
		}
		return out, nil
	}
	return func(ctx context.Context) error { return endGroups(ctx, check, syscall.Kill, waitEnd) }, nil
}

func waitEnd(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func endGroups(ctx context.Context, check func() ([]int, error), signal func(int, syscall.Signal) error, wait func(context.Context, time.Duration) error) error {
	for n, sig := range []syscall.Signal{syscall.SIGTERM, syscall.SIGKILL} {
		if err := ctx.Err(); err != nil {
			return err
		}
		groups, err := check()
		if err != nil {
			return err
		}
		if len(groups) == 0 {
			return nil
		}
		for _, group := range groups {
			if group <= 1 {
				return ErrNotInSession
			}
			if err := signal(-group, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
				return err
			}
		}
		if n == 0 {
			if err := wait(ctx, 10*time.Second); err != nil {
				return err
			}
		}
	}
	return nil
}
