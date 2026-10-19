package rollover

import (
	"math"
	"time"
)

type State string

const (
	OK         State = "ok"
	Due        State = "due"
	Countdown  State = "countdown"
	HandingOff State = "handing_off"
	Cancelled  State = "cancelled"
	Failed     State = "failed"
)

const ConfirmInterval = 15 * time.Second

type View struct {
	State  State  `json:"state"`
	Pct    int    `json:"pct"`
	EndsAt int64  `json:"endsAt,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// Memory is derived state. A fresh value always has to observe the threshold
// twice, even if the persisted session row says it has been idle for hours.
type Memory struct {
	View
	SeenAt      time.Time
	AboveAt     time.Time
	Postponed   bool
	Compaction  bool
	Requested   bool
	Attempts    []time.Time
	CountdownAt time.Time
}

type Observation struct {
	Recorded, Scratch, Archived, Exited, HomeWorker bool
	Agent                                           string
	Used, Window                                    int64
	Done, HookBacked                                bool
	QuietSince, LastInput                           time.Time
	Draft, Background, Busy, Never                  bool
	PreCompact, Now                                 bool
}

func (o Observation) Eligible() bool {
	return o.Recorded && (o.Agent == "claude" || o.Agent == "codex") &&
		!o.Scratch && !o.Archived && !o.Exited && !o.HomeWorker && o.Window > 0 && o.Used >= 0
}

func (o Observation) percent() float64 {
	if o.Window <= 0 {
		return 0
	}
	return float64(o.Used) / float64(o.Window) * 100
}

func boundary(m Memory, o Observation, p Policy, now time.Time) bool {
	quiet := o.QuietSince
	if quiet.Before(m.SeenAt) {
		quiet = m.SeenAt
	}
	input := o.LastInput
	if input.Before(m.SeenAt) {
		input = m.SeenAt
	}
	return o.Done && !o.Draft && !o.Background && !o.Busy &&
		now.Sub(input) >= time.Duration(p.IdleInputSeconds)*time.Second &&
		(o.HookBacked || now.Sub(quiet) >= 2*time.Minute)
}

type Result struct {
	Memory Memory
	Events []View
	Start  bool
}

type rule struct {
	from, to State
	when     func(Memory, Observation, Policy, time.Time) bool
}

var rules = []rule{
	{OK, Due, func(m Memory, _ Observation, _ Policy, now time.Time) bool {
		return m.Compaction || m.Requested || !m.AboveAt.IsZero() && now.Sub(m.AboveAt) >= ConfirmInterval
	}},
	{Due, Countdown, boundary},
	{Countdown, Due, func(m Memory, o Observation, p Policy, now time.Time) bool { return !boundary(m, o, p, now) }},
	{Countdown, HandingOff, func(m Memory, _ Observation, _ Policy, now time.Time) bool { return now.UnixMilli() >= m.EndsAt }},
}

// Step makes at most one transition. Pct and EndsAt are captured on a transition,
// not refreshed on every tick: a countdown must not broadcast a whole snapshot
// every second. The browser owns the ticking number.
func Step(m Memory, o Observation, p Policy, now time.Time) Result {
	if m.State == "" {
		m.State = OK
	}
	if m.SeenAt.IsZero() {
		m.SeenAt = now
	}
	kept := make([]time.Time, 0, len(m.Attempts))
	for _, at := range m.Attempts {
		if now.Sub(at) < 24*time.Hour {
			kept = append(kept, at)
		}
	}
	m.Attempts = kept
	if m.State == HandingOff {
		return Result{Memory: m}
	}
	// A person pressing the button decided this session should be handed off.
	// The switch, the per-session "never" and the daily cap all exist to hold
	// back *automatic* triggers; applying them to an explicit request meant a
	// panel with auto-rollover off had a button that could never do anything.
	// Requested is the memory of that decision across polls, because o.Now is
	// true only on the call that carried it. The session still has to be
	// eligible and quiet: the boundary and the countdown are not skipped.
	manual := o.Now || m.Requested
	if !o.Eligible() || o.Busy || !manual && (!p.Enabled || o.Never || len(m.Attempts) >= 3) {
		m.AboveAt, m.Compaction, m.Requested = time.Time{}, false, false
		if m.State == Due || m.State == Countdown {
			return cancel(m, "unavailable", false)
		}
		return Result{Memory: m}
	}
	if m.State == Countdown && o.LastInput.After(m.CountdownAt) {
		return Cancel(m, "input")
	}
	if o.PreCompact && o.Agent == "claude" {
		m.Compaction = true
	}
	if o.Now {
		m.Requested = true
		if m.State == Failed {
			m.State = OK
		}
	}
	threshold := p.ThresholdPct
	if m.Postponed {
		threshold += 10
	}
	if o.percent() < float64(threshold) {
		m.AboveAt = time.Time{}
	} else if m.AboveAt.IsZero() {
		m.AboveAt = now
	}
	// Compaction may drop usage while a session waits for a boundary. A due
	// request stays due; cancellation is the explicit way to postpone it.
	for _, r := range rules {
		if m.State != r.from || !r.when(m, o, p, now) {
			continue
		}
		reason := m.Reason
		if m.State == OK {
			reason = "threshold"
			if m.Compaction {
				reason = "precompact"
			}
			if m.Requested {
				reason = "now"
			}
		}
		m.View = View{State: r.to, Pct: int(math.Round(o.percent())), Reason: reason}
		if r.to == Countdown {
			m.CountdownAt = now
			m.EndsAt = now.Add(time.Duration(p.CountdownSeconds) * time.Second).UnixMilli()
		}
		if r.to == HandingOff {
			m.Attempts = append(m.Attempts, now)
		}
		return Result{Memory: m, Events: []View{m.View}, Start: r.to == HandingOff}
	}
	return Result{Memory: m}
}

func cancel(m Memory, reason string, postpone bool) Result {
	event := View{State: Cancelled, Pct: m.Pct, Reason: reason}
	m.View = View{State: OK}
	m.AboveAt, m.CountdownAt = time.Time{}, time.Time{}
	m.Compaction, m.Requested = false, false
	m.Postponed = m.Postponed || postpone
	return Result{Memory: m, Events: []View{event}}
}

func Cancel(m Memory, reason string) Result { return cancel(m, reason, true) }

// Suspend withdraws a request without interpreting a policy change or memory
// pressure as the person's choice to raise this session's threshold.
func Suspend(m Memory, reason string) Result { return cancel(m, reason, false) }

// Finish is the execution seam. R2 calls the existing long/resume primitive;
// R3 can retain HandingOff while verifying the replacement before finishing.
func Finish(m Memory, err error) Result {
	if err != nil {
		m.View = View{State: Failed, Pct: m.Pct, Reason: err.Error()}
		return Result{Memory: m, Events: []View{m.View}}
	}
	m.View = View{State: OK}
	m.AboveAt, m.Compaction, m.Requested = time.Time{}, false, false
	return Result{Memory: m}
}
