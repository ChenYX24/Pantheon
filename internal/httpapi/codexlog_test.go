package httpapi

import (
	"testing"
	"time"
)

// A session whose hooks report is never overruled by its log, and a shell is
// never read as a Codex. A Codex installed by npm runs as `node`, which is a
// Codex only when the session was launched as one.
func TestTheRolloutIsReadOnlyForAQuietCodex(t *testing.T) {
	now := time.Now()
	npm := []string{"/home/u/.local/bin/codex", "--dangerously-bypass-approvals-and-sandbox"}
	for _, tc := range []struct {
		name     string
		command  string
		launch   []string
		lastHook time.Time
		want     bool
	}{
		{"codex, never reported", "codex", nil, time.Time{}, true},
		{"codex, reported a minute ago", "codex", nil, now.Add(-time.Minute), false},
		{"codex, quiet for an hour", "codex", nil, now.Add(-time.Hour), true},
		{"codex from npm, never reported", "node", npm, time.Time{}, true},
		{"codex from npm, reported a minute ago", "node", npm, now.Add(-time.Minute), false},
		{"codex from npm, exited to its shell", "bash", npm, time.Time{}, false},
		{"node typed into a shell", "node", nil, time.Time{}, false},
		{"node launched as something else", "node", []string{"node", "codex"}, time.Time{}, false},
		{"claude", "claude", nil, time.Time{}, false},
		{"a shell", "bash", nil, time.Time{}, false},
	} {
		if got := readCodexLog(tc.command, tc.launch, tc.lastHook, now); got != tc.want {
			t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
		}
	}
}
