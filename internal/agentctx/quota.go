package agentctx

import (
	"encoding/json"
	"math"
	"time"
)

const (
	// ClaudeStatusLine is a reading Claude Code handed its status line
	// command: the only place it says what is left of a subscription. Its
	// transcripts carry tokens, not limits; measured on 2.1.310, a Max login
	// fills rate_limits after the first reply and an API-billed one never does.
	ClaudeStatusLine = "claude-statusline"
)

// Limit is one rolling window of a subscription: five hours, seven days.
type Limit struct {
	Minutes int64 `json:"minutes"`
	// Used is a whole percent. Rounded, like context usage, so that a reading
	// that moved by a fraction does not resend every viewer the snapshot.
	Used int `json:"used"`
	// ResetsAt is Unix seconds, or zero when the agent did not say. A window
	// whose reset has passed is the agent's last word about a window that no
	// longer exists, and the page leaves it out rather than the server, so
	// the snapshot does not change on its own when a clock crosses a line.
	ResetsAt int64 `json:"resetsAt"`
}

// Quota is what an account has used of its subscription's windows.
type Quota struct {
	Limits []Limit `json:"limits"`
	// Plan is Codex's plan_type ("plus", "pro"); Claude Code does not say.
	Plan   string    `json:"plan"`
	Source string    `json:"source"`
	At     time.Time `json:"at"`
}

// Same is whether two readings would serialise identically apart from At.
func (q Quota) Same(o Quota) bool {
	if q.Plan != o.Plan || q.Source != o.Source || len(q.Limits) != len(o.Limits) {
		return false
	}
	for i := range q.Limits {
		if q.Limits[i] != o.Limits[i] {
			return false
		}
	}
	return true
}

// A window longer than a month or a reset past 2100 is not a limit any agent
// has, and a document carrying one is not to be drawn as if it were.
const (
	maxWindowMinutes = 31 * 24 * 60
	maxResetsAt      = 4102444800
)

// limit checks one window. Over 100 is allowed: a spend limit can be exceeded,
// and saying 112% is the truth; a negative or non-finite figure is a document
// the panel does not understand, and drawing nothing is better than drawing it.
func limit(minutes int64, used float64, resetsAt float64) (Limit, bool) {
	if minutes <= 0 || minutes > maxWindowMinutes || math.IsNaN(used) || math.IsInf(used, 0) ||
		used < 0 || used > 1000 || math.IsNaN(resetsAt) || resetsAt < 0 || resetsAt > maxResetsAt {
		return Limit{}, false
	}
	return Limit{Minutes: minutes, Used: int(math.Round(used)), ResetsAt: int64(resetsAt)}, true
}

// ClaudeLimits reads the rate_limits of the document Claude Code pipes to a
// status line command. Only the two windows its documentation names are read;
// a window it adds later is ignored rather than guessed at, and a document with
// neither is not a reading.
func ClaudeLimits(body []byte, at time.Time) (Quota, bool) {
	if len(body) > maxRead {
		return Quota{}, false
	}
	type window struct {
		Used     *float64 `json:"used_percentage"`
		ResetsAt *float64 `json:"resets_at"`
	}
	var doc struct {
		Limits *struct {
			FiveHour *window `json:"five_hour"`
			SevenDay *window `json:"seven_day"`
		} `json:"rate_limits"`
	}
	if json.Unmarshal(body, &doc) != nil || doc.Limits == nil {
		return Quota{}, false
	}
	q := Quota{Source: ClaudeStatusLine, At: at}
	for _, w := range []struct {
		minutes int64
		w       *window
	}{{5 * 60, doc.Limits.FiveHour}, {7 * 24 * 60, doc.Limits.SevenDay}} {
		if w.w == nil || w.w.Used == nil {
			continue
		}
		var resets float64
		if w.w.ResetsAt != nil {
			resets = *w.w.ResetsAt
		}
		l, ok := limit(w.minutes, *w.w.Used, resets)
		if !ok {
			return Quota{}, false
		}
		q.Limits = append(q.Limits, l)
	}
	return q, len(q.Limits) > 0
}

// codexLimits reads the rate_limits beside a token_count. Codex sends a
// window as primary and, on some plans, a second one; which is which is said
// by window_minutes and not by position (a Pro login on 0.164.0 has a single
// seven-day primary and a null secondary). Only the general "codex" limit is
// read: a model-specific bucket under another limit_id alternating with it
// would make the figure jump between two unrelated numbers.
func codexLimits(raw json.RawMessage, at time.Time) (*Quota, bool) {
	type window struct {
		Used     *float64 `json:"used_percent"`
		Minutes  int64    `json:"window_minutes"`
		ResetsAt float64  `json:"resets_at"`
	}
	var doc struct {
		LimitID   string  `json:"limit_id"`
		Primary   *window `json:"primary"`
		Secondary *window `json:"secondary"`
		Plan      string  `json:"plan_type"`
	}
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, &doc) != nil {
		return nil, false
	}
	if doc.LimitID != "" && doc.LimitID != "codex" {
		return nil, false
	}
	q := &Quota{Source: Codex, At: at, Plan: plan(doc.Plan)}
	for _, w := range []*window{doc.Primary, doc.Secondary} {
		if w == nil || w.Used == nil {
			continue
		}
		l, ok := limit(w.Minutes, *w.Used, w.ResetsAt)
		if !ok {
			return nil, false
		}
		q.Limits = append(q.Limits, l)
	}
	if len(q.Limits) == 0 {
		return nil, false
	}
	// Shortest window first, whichever slot Codex put it in, so a page reads
	// "5h · 7d" the same way for both agents.
	if len(q.Limits) == 2 && q.Limits[0].Minutes > q.Limits[1].Minutes {
		q.Limits[0], q.Limits[1] = q.Limits[1], q.Limits[0]
	}
	return q, true
}

// plan keeps a plan name only when it looks like one: it is shown on the page.
func plan(s string) string {
	if len(s) == 0 || len(s) > 32 {
		return ""
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return ""
		}
	}
	return s
}
