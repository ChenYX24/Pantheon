// Package rollover decides when context use may request a session handoff.
// It owns no processes, files, goroutines or clocks; callers supply observations
// and time, and execute only the Start decision through the rollover primitive.
package rollover

import "fmt"

type Policy struct {
	Enabled          bool `json:"enabled"`
	ThresholdPct     int  `json:"thresholdPct"`
	CountdownSeconds int  `json:"countdownSeconds"`
	KeepOldMinutes   int  `json:"keepOldMinutes"`
	IdleInputSeconds int  `json:"idleInputSeconds"`
}

func DefaultPolicy() Policy {
	return Policy{Enabled: true, ThresholdPct: 70, CountdownSeconds: 30, KeepOldMinutes: 10, IdleInputSeconds: 120}
}

func (p Policy) Validate() error {
	for _, field := range []struct {
		name            string
		value, min, max int
	}{
		{"thresholdPct", p.ThresholdPct, 30, 95},
		{"countdownSeconds", p.CountdownSeconds, 5, 300},
		{"keepOldMinutes", p.KeepOldMinutes, 1, 120},
		{"idleInputSeconds", p.IdleInputSeconds, 10, 1800},
	} {
		if field.value < field.min || field.value > field.max {
			return fmt.Errorf("%s must be %d–%d", field.name, field.min, field.max)
		}
	}
	return nil
}
