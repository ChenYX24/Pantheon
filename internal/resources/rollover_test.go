package resources

import (
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/session"
)

func TestRolloverIdleCulpritAndExclusions(t *testing.T) {
	now := time.Now()
	w := &world{sessions: []SessionMeta{
		{ID: "working", State: session.StateWorking},
		{ID: "idle", State: session.StateDone, StateChangedAt: now.Add(-20 * time.Minute)},
		{ID: "waiting", State: session.StateWaiting, StateChangedAt: now.Add(-20 * time.Minute)},
		{ID: "pinned", Pinned: true, State: session.StateDone, StateChangedAt: now.Add(-20 * time.Minute)},
		{ID: "worker", HomeWorker: true, State: session.StateDone, StateChangedAt: now.Add(-20 * time.Minute)},
		{ID: "rolling", State: session.StateDone, StateChangedAt: now.Add(-20 * time.Minute)},
	}}
	env := w.env()
	env.RollingOver = func(id string) bool { return id == "rolling" }
	g := New(env)
	params := DefaultPolicy().At(now)
	sessions := []SessionView{{ID: "working", Held: 5 * gib}, {ID: "idle", Held: gib}, {ID: "waiting", Held: 2 * gib}, {ID: "pinned", Held: 6 * gib}, {ID: "worker", Held: 6 * gib}, {ID: "rolling", Held: 6 * gib}}
	g.decide(now, params, Critical, ReasonStall, poolReading, sessions, &Layout{}, g.roster(), LazyProcs())
	if g.Alert().SessionID != "waiting" {
		t.Fatal(g.Alert())
	}
	sessions[2].Priority = PriorityHigh
	g.decide(now, params, Critical, ReasonStall, poolReading, sessions, &Layout{}, g.roster(), LazyProcs())
	if g.Alert().SessionID != "idle" {
		t.Fatal(g.Alert())
	}
	ro := g.roster()
	ro.byID["unknown"] = SessionMeta{ID: "unknown"}
	unknown := []SessionView{{ID: "unknown", Held: 2 * gib}}
	if g.rolloverCulprit(unknown, ro, params, now) != nil {
		t.Fatal("unknown without CPU history")
	}
	g.t.coldSince["unknown"] = now.Add(-time.Minute)
	if g.rolloverCulprit(unknown, ro, params, now) == nil {
		t.Fatal("unknown idle ignored")
	}
	unknown[0].CPUPercent = 2
	if g.rolloverCulprit(unknown, ro, params, now) != nil {
		t.Fatal("busy unknown selected")
	}
}

func TestRolloverGovernorSerialAndDisabled(t *testing.T) {
	now := time.Now()
	started := make(chan string, 2)
	finish := make(chan struct{})
	done := make(chan struct{})
	w := &world{sessions: []SessionMeta{{ID: "a", State: session.StateWorking}}}
	env := w.env()
	env.Rollover = func(id string, resume bool, grace time.Duration) error {
		if !resume || grace != time.Minute {
			t.Error(resume, grace)
		}
		started <- id
		<-finish
		close(done)
		return nil
	}
	g := New(env)
	p := DefaultPolicy()
	p.AutoResume = true
	params := p.At(now)
	views := []SessionView{{ID: "a", Held: gib}}
	tick := func(at time.Time) {
		g.decide(at, params, Critical, ReasonStall, poolReading, views, &Layout{}, g.roster(), LazyProcs())
	}
	tick(now)
	tick(now.Add(91 * time.Second))
	select {
	case id := <-started:
		if id != "a" {
			t.Fatal(id)
		}
	case <-time.After(time.Second):
		t.Fatal("no rollover")
	}
	if a := g.Alert(); a == nil || !a.Rollover || a.AutoAt != now.Add(211*time.Second).Unix() {
		t.Fatal(a)
	}
	tick(now.Add(200 * time.Second))
	select {
	case <-started:
		t.Fatal("overlapping rollovers")
	default:
	}
	close(finish)
	<-done
	// Legacy policy never invokes the rollover callback, including under pressure.
	other := New(env)
	params.Rollover = false
	other.decide(now, params, Critical, ReasonStall, poolReading, views, nil, other.roster(), LazyProcs())
	if a := other.Alert(); a != nil && a.Rollover {
		t.Fatal(a)
	}
}
