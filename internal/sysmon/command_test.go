package sysmon

import (
	"strings"
	"testing"
)

func TestDisplayCommandShowsWhatAnAgentRan(t *testing.T) {
	wrapper := func(inner string) []string {
		return []string{"/bin/bash", "-c",
			"source /home/u/.claude/shell-snapshots/snapshot-bash-1-x.sh 2>/dev/null || true && " +
				"shopt -u extglob 2>/dev/null || true && eval " + inner + " && pwd -P >| /tmp/claude-ab-cwd"}
	}
	cases := []struct {
		name string
		argv []string
		want string
	}{
		{"Claude Code's wrapper", wrapper(`'go test ./...'`), "go test ./..."},
		{"quotes inside the command", wrapper(`'tr '"'"'\0'"'"' x'`), `tr '\0' x`},
		{"a plain argv", []string{"node", "server.js", "--port", "3000"}, "node server.js --port 3000"},
		{"bash -c that is not the wrapper", []string{"bash", "-c", "make && eval 'x'"}, "bash -c make && eval 'x'"},
		{"an eval that does not parse", wrapper(`'unterminated`), ""},
		{"a kernel thread", nil, ""},
		{"a script over several lines", []string{"sh", "-c", "a\n  b"}, "sh -c a b"},
	}
	for _, c := range cases {
		got := displayCommand(c.argv)
		if c.name == "an eval that does not parse" {
			// Shown as it is rather than guessed at.
			if !strings.HasPrefix(got, "/bin/bash -c source") {
				t.Errorf("%s: %q, want the raw command line", c.name, got)
			}
			continue
		}
		if got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
	long := displayCommand([]string{"cc", strings.Repeat("x", 500)})
	if n := len([]rune(long)); n != cmdMax || !strings.HasSuffix(long, "…") {
		t.Errorf("a long command line is %d runes, want %d ending in an ellipsis", n, cmdMax)
	}
}
