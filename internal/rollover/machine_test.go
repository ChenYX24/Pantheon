package rollover

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

var epoch = time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)

func observation() Observation {
	return Observation{Recorded: true, Agent: "claude", Used: 72, Window: 100,
		Done: true, HookBacked: true, QuietSince: epoch.Add(-time.Hour)}
}

func TestTransitions(t *testing.T) {
	p := DefaultPolicy()
	ready := Memory{View: View{State: Due, Pct: 72, Reason: "threshold"}, SeenAt: epoch.Add(-time.Hour)}
	counting := Step(ready, observation(), p, epoch).Memory
	for _, tc := range []struct {
		name  string
		m     Memory
		o     Observation
		at    time.Time
		want  State
		start bool
	}{
		{"first observation", Memory{}, observation(), epoch, OK, false},
		{"second too early", Memory{AboveAt: epoch}, observation(), epoch.Add(14 * time.Second), OK, false},
		{"second at 15 seconds", Memory{AboveAt: epoch}, observation(), epoch.Add(15 * time.Second), Due, false},
		{"due at boundary", ready, observation(), epoch, Countdown, false},
		{"countdown running", counting, observation(), epoch.Add(29 * time.Second), Countdown, false},
		{"countdown elapsed", counting, observation(), epoch.Add(30 * time.Second), HandingOff, true},
		{"handoff never runs twice", Memory{View: View{State: HandingOff}}, observation(), epoch, HandingOff, false},
		{"failure does not retry automatically", Memory{View: View{State: Failed}, AboveAt: epoch.Add(-time.Hour)}, observation(), epoch, Failed, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := Step(tc.m, tc.o, p, tc.at)
			if r.Memory.State != tc.want || r.Start != tc.start {
				t.Fatalf("%+v, start %v; want %s, %v", r.Memory, r.Start, tc.want, tc.start)
			}
		})
	}
}

func TestBoundaryWaits(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*Observation)
	}{
		{"working", func(o *Observation) { o.Done = false }},
		{"waiting on permission choice or question", func(o *Observation) { o.Done = false }},
		{"recent input", func(o *Observation) { o.LastInput = epoch.Add(-119 * time.Second) }},
		{"compose draft", func(o *Observation) { o.Draft = true }},
		{"background command", func(o *Observation) { o.Background = true }},
		{"heuristic not quiet", func(o *Observation) { o.HookBacked = false; o.QuietSince = epoch.Add(-119 * time.Second) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := observation()
			tc.edit(&o)
			m := Memory{View: View{State: Due}, SeenAt: epoch.Add(-time.Hour)}
			if r := Step(m, o, DefaultPolicy(), epoch); r.Memory.State != Due || r.Start {
				t.Fatalf("unsafe boundary: %+v", r)
			}
			m.View = View{State: Countdown, EndsAt: epoch.UnixMilli()}
			m.CountdownAt = epoch.Add(-30 * time.Second)
			r := Step(m, o, DefaultPolicy(), epoch)
			if r.Memory.State != Due || r.Start || r.Memory.EndsAt != 0 {
				t.Fatalf("lost boundary completed countdown: %+v", r)
			}
		})
	}
	for _, hook := range []bool{true, false} {
		o := observation()
		o.HookBacked, o.QuietSince, o.LastInput = hook, epoch.Add(-2*time.Minute), epoch.Add(-2*time.Minute)
		m := Memory{View: View{State: Due}, SeenAt: epoch.Add(-time.Hour)}
		if r := Step(m, o, DefaultPolicy(), epoch); r.Memory.State != Countdown {
			t.Fatalf("quiet done boundary held back (hook %v): %+v", hook, r)
		}
	}
}

func TestEligibilityAndPolicy(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*Observation, *Policy)
	}{
		{"disabled", func(_ *Observation, p *Policy) { p.Enabled = false }},
		{"never", func(o *Observation, _ *Policy) { o.Never = true }},
		{"unrecorded", func(o *Observation, _ *Policy) { o.Recorded = false }},
		{"shell", func(o *Observation, _ *Policy) { o.Agent = "shell" }},
		{"other agent", func(o *Observation, _ *Policy) { o.Agent = "kimi" }},
		{"scratch", func(o *Observation, _ *Policy) { o.Scratch = true }},
		{"archived", func(o *Observation, _ *Policy) { o.Archived = true }},
		{"exited", func(o *Observation, _ *Policy) { o.Exited = true }},
		{"home worker", func(o *Observation, _ *Policy) { o.HomeWorker = true }},
		{"unknown window", func(o *Observation, _ *Policy) { o.Window = 0 }},
		{"negative usage", func(o *Observation, _ *Policy) { o.Used = -1 }},
		{"memory or existing handoff", func(o *Observation, _ *Policy) { o.Busy = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o, p := observation(), DefaultPolicy()
			tc.edit(&o, &p)
			o.PreCompact = true
			for _, state := range []State{OK, Due, Countdown} {
				m := Memory{View: View{State: state}, SeenAt: epoch.Add(-time.Hour), AboveAt: epoch.Add(-time.Hour)}
				if r := Step(m, o, p, epoch); r.Memory.State != OK || r.Start {
					t.Fatalf("%s remained eligible: %+v", state, r)
				}
			}
		})
	}
}

func TestThresholdNeedsConsecutiveObservationsAndRestartGrace(t *testing.T) {
	o, p := observation(), DefaultPolicy()
	m := Step(Memory{}, o, p, epoch).Memory
	o.Used = 69
	m = Step(m, o, p, epoch.Add(15*time.Second)).Memory
	o.Used = 70
	m = Step(m, o, p, epoch.Add(30*time.Second)).Memory
	if m.State != OK {
		t.Fatal("a below-threshold poll did not reset confirmation")
	}
	m = Step(m, o, p, epoch.Add(45*time.Second)).Memory
	if m.State != Due {
		t.Fatal("second qualifying poll did not mark due")
	}
	m = Step(m, o, p, epoch.Add(46*time.Second)).Memory
	if m.State != Due {
		t.Fatal("restart assumed there had been no input before observation")
	}
	m = Step(m, o, p, epoch.Add(120*time.Second)).Memory
	if m.State != Countdown {
		t.Fatal("boundary did not open after startup input grace")
	}
	if r := Step(Memory{}, o, p, epoch.Add(time.Hour)); r.Memory.State != OK || r.Start {
		t.Fatal("restart reused prior confirmation")
	}
}

func TestCancelInputAndCooldown(t *testing.T) {
	o, p := observation(), DefaultPolicy()
	m := Memory{View: View{State: Due}, SeenAt: epoch.Add(-time.Hour)}
	m = Step(m, o, p, epoch).Memory
	o.LastInput = epoch.Add(time.Second)
	r := Step(m, o, p, epoch.Add(time.Second))
	if r.Memory.State != OK || !r.Memory.Postponed || len(r.Events) != 1 || r.Events[0].State != Cancelled {
		t.Fatalf("input did not cancel: %+v", r)
	}
	m = r.Memory
	for _, used := range []int64{70, 79} {
		o.Used = used
		m = Step(m, o, p, epoch.Add(time.Hour)).Memory
		m = Step(m, o, p, epoch.Add(time.Hour+15*time.Second)).Memory
		if m.State != OK {
			t.Fatal("cancelled threshold lost its ten-point margin")
		}
	}
	o.Used = 80
	m = Step(m, o, p, epoch.Add(2*time.Hour)).Memory
	m = Step(m, o, p, epoch.Add(2*time.Hour+15*time.Second)).Memory
	if m.State != Due {
		t.Fatal("threshold + 10 did not become due")
	}
}

func TestPreCompactAndNow(t *testing.T) {
	for _, tc := range []struct {
		name, agent string
		window      int64
		signal, now bool
		want        State
	}{
		{"Claude below threshold", "claude", 100, true, false, Due},
		{"Codex has no hook", "codex", 100, true, false, OK},
		{"unknown window even with hook", "claude", 0, true, false, OK},
		{"explicit now", "codex", 100, false, true, Due},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := observation()
			o.Agent, o.Used, o.Window, o.PreCompact, o.Now, o.Done = tc.agent, 10, tc.window, tc.signal, tc.now, false
			r := Step(Memory{}, o, DefaultPolicy(), epoch)
			if r.Memory.State != tc.want || r.Start {
				t.Fatalf("%+v", r)
			}
			if r.Memory.State == Due {
				o.PreCompact, o.Now = false, false
				if r = Step(r.Memory, o, DefaultPolicy(), epoch.Add(time.Hour)); r.Memory.State != Due {
					t.Fatal("signal bypassed working boundary")
				}
			}
		})
	}
}

func TestCapFinishAndStableSnapshot(t *testing.T) {
	o, p := observation(), DefaultPolicy()
	m := Memory{View: View{State: Due, Pct: 72}, SeenAt: epoch.Add(-time.Hour)}
	for i := range 3 {
		at := epoch.Add(time.Duration(i) * time.Hour)
		m = Step(m, o, p, at).Memory
		original := m
		for j := 1; j < 30; j++ {
			r := Step(m, o, p, at.Add(time.Duration(j)*time.Second))
			if !reflect.DeepEqual(r.Memory.View, original.View) || len(r.Events) != 0 {
				t.Fatal("countdown churned")
			}
		}
		r := Step(m, o, p, at.Add(30*time.Second))
		if !r.Start || len(r.Memory.Attempts) != i+1 {
			t.Fatalf("attempt %d: %+v", i, r)
		}
		m = Finish(r.Memory, nil).Memory
		m.State = Due
	}
	if r := Step(m, o, p, epoch.Add(3*time.Hour)); r.Memory.State != OK || r.Start {
		t.Fatal("fourth rollover allowed")
	}
	m.State = Due
	if r := Step(m, o, p, epoch.Add(24*time.Hour+30*time.Second)); r.Memory.State != Countdown {
		t.Fatal("24h cap did not expire")
	}
	r := Finish(Memory{View: View{State: HandingOff}}, errors.New("could not start replacement"))
	if r.Memory.State != Failed || r.Events[0].Reason != "could not start replacement" {
		t.Fatal(r)
	}
}

func TestPolicyRanges(t *testing.T) {
	if err := DefaultPolicy().Validate(); err != nil {
		t.Fatal(err)
	}
	for _, field := range []struct {
		name     string
		min, max int
		set      func(*Policy, int)
	}{
		{"threshold", 30, 95, func(p *Policy, n int) { p.ThresholdPct = n }},
		{"countdown", 5, 300, func(p *Policy, n int) { p.CountdownSeconds = n }},
		{"idle", 10, 1800, func(p *Policy, n int) { p.IdleInputSeconds = n }},
		{"keep", 1, 120, func(p *Policy, n int) { p.KeepOldMinutes = n }},
	} {
		for _, n := range []int{field.min - 1, field.min, field.max, field.max + 1} {
			p := DefaultPolicy()
			field.set(&p, n)
			if err := p.Validate(); (err == nil) != (n >= field.min && n <= field.max) {
				t.Errorf("%s=%d: %v", field.name, n, err)
			}
		}
	}
}

// The button is a person's decision. It must work with the switch off, with
// "never for this session" set and after the daily cap, and it must keep
// working on the polls after the one that carried it -- while still waiting
// for the turn to end and still counting down.
func TestAnExplicitRequestOutranksTheAutomaticSwitches(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*Observation, *Policy, *Memory)
	}{
		{"switch off", func(_ *Observation, p *Policy, _ *Memory) { p.Enabled = false }},
		{"never for this session", func(o *Observation, _ *Policy, _ *Memory) { o.Never = true }},
		{"daily cap", func(_ *Observation, _ *Policy, m *Memory) {
			m.Attempts = []time.Time{epoch.Add(-3 * time.Hour), epoch.Add(-2 * time.Hour), epoch.Add(-time.Hour)}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o, p, m := observation(), DefaultPolicy(), Memory{}
			o.Used = 8 // far below the threshold: this is not the threshold's doing
			tc.edit(&o, &p, &m)

			busy := o
			busy.Done, busy.Now = false, true
			r := Step(m, busy, p, epoch)
			if r.Memory.State != Due || r.Start {
				t.Fatalf("the request while working: %+v", r)
			}
			// Later polls carry no Now; the request must survive them.
			busy.Now = false
			if r = Step(r.Memory, busy, p, epoch.Add(time.Minute)); r.Memory.State != Due {
				t.Fatalf("the request was forgotten by the next poll: %+v", r)
			}
			quiet := o
			quiet.QuietSince = epoch.Add(-time.Hour)
			at := epoch.Add(5 * time.Minute)
			if r = Step(r.Memory, quiet, p, at); r.Memory.State != Countdown {
				t.Fatalf("the boundary did not start the countdown: %+v", r)
			}
			if r = Step(r.Memory, quiet, p, at.Add(time.Duration(p.CountdownSeconds)*time.Second)); r.Memory.State != HandingOff || !r.Start {
				t.Fatalf("the countdown did not hand off: %+v", r)
			}
		})
	}
}

// Without a request the same switches still hold, and ineligible sessions are
// refused whatever was asked.
func TestWithoutARequestTheSwitchesStillHold(t *testing.T) {
	o, p := observation(), DefaultPolicy()
	p.Enabled = false
	if r := Step(Memory{}, o, p, epoch); r.Memory.State != OK {
		t.Fatalf("%+v", r)
	}
	o, p = observation(), DefaultPolicy()
	o.Now, o.Exited = true, true
	if r := Step(Memory{}, o, p, epoch); r.Memory.State != OK {
		t.Fatalf("an exited session accepted a request: %+v", r)
	}
	o.Exited, o.Busy = false, true
	if r := Step(Memory{}, o, p, epoch); r.Memory.State != OK {
		t.Fatalf("a busy session accepted a request: %+v", r)
	}
}

// A due session that is not moving has to be able to say why. Each reason is
// the first thing in boundary's list that is false, and the view changes only
// when the reason does: it is broadcast to every tab, so it must not tick.
func TestADueSessionSaysWhatItIsWaitingFor(t *testing.T) {
	p := DefaultPolicy()
	for _, tc := range []struct {
		name string
		edit func(*Observation, time.Time)
		want string
	}{
		{"working", func(o *Observation, _ time.Time) { o.Done = false }, WaitTurn},
		{"a draft", func(o *Observation, _ time.Time) { o.Draft = true }, WaitDraft},
		{"a background task", func(o *Observation, _ time.Time) { o.Background = true }, WaitBackground},
		// A session first seen a second ago counts as just active.
		{"just seen, so just active", func(*Observation, time.Time) {}, WaitInput},
		// Past the input gap, with output newer than the first sighting and
		// no hook to vouch that the turn is over: the two-minute gate.
		{"done but nothing vouches for it", func(o *Observation, at time.Time) {
			o.HookBacked, o.QuietSince = false, at.Add(-10*time.Second)
		}, WaitQuiet},
		// Two things at once: the one the person can act on first.
		{"working and a draft", func(o *Observation, _ time.Time) { o.Done, o.Draft = false, true }, WaitTurn},
		{"a draft and a background task", func(o *Observation, _ time.Time) { o.Draft, o.Background = true, true }, WaitDraft},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := observation()
			o.Now = true
			start := Step(Memory{}, o, p, epoch).Memory
			if start.State != Due {
				t.Fatalf("not due: %+v", start)
			}
			at := epoch.Add(time.Second)
			if tc.want == WaitQuiet {
				at = epoch.Add(time.Duration(p.IdleInputSeconds+10) * time.Second)
			}
			tc.edit(&o, at)
			o.Now = false
			r := Step(start, o, p, at)
			// Becoming due already carries a reason, so a case whose reason is
			// the one it started with is correctly not news.
			if r.Memory.State != Due || r.Memory.Waiting != tc.want || r.Changed != (start.Waiting != tc.want) || len(r.Events) != 0 {
				t.Fatalf("want waiting %q (changed=%v), no event: %+v", tc.want, start.Waiting != tc.want, r)
			}
			// The same blocker a second later is not news.
			if again := Step(r.Memory, o, p, at.Add(time.Second)); again.Changed || again.Memory.Waiting != tc.want {
				t.Fatalf("a steady blocker was announced again: %+v", again)
			}
		})
	}
}

func TestTheReasonClearsAtTheBoundaryAndOutsideDue(t *testing.T) {
	p := DefaultPolicy()
	o := observation()
	o.Now, o.Done = true, false
	due := Step(Memory{}, o, p, epoch).Memory
	due = Step(due, Observation{Recorded: true, Agent: "claude", Used: 72, Window: 100, Done: true, HookBacked: true, QuietSince: epoch.Add(-time.Hour), Draft: true}, p, epoch.Add(time.Second)).Memory
	if due.Waiting != WaitDraft {
		t.Fatalf("setup: %+v", due)
	}
	o = observation()
	r := Step(due, o, p, epoch.Add(3*time.Minute))
	if r.Memory.State != Countdown || r.Memory.Waiting != "" || len(r.Events) != 1 {
		t.Fatalf("the boundary should start the countdown with no reason: %+v", r)
	}
	// Cancelling clears it too: a stale reason on an ok session would show up
	// the next time it is requested, before anything had been observed.
	if c := Cancel(due, "later"); c.Memory.Waiting != "" {
		t.Fatalf("a cancelled request kept its reason: %+v", c.Memory)
	}
}

// The snapshot that announces "due" must already say why, or every session that
// becomes due is published twice.
func TestBecomingDueCarriesItsReason(t *testing.T) {
	o := observation()
	o.Now, o.Done = true, false
	r := Step(Memory{}, o, DefaultPolicy(), epoch)
	if r.Memory.State != Due || r.Memory.Waiting != WaitTurn || len(r.Events) != 1 || r.Events[0].Waiting != WaitTurn {
		t.Fatalf("%+v", r)
	}
}
