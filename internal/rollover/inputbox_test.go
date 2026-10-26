package rollover

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func screen(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name+".txt"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The real screens: each agent idle at its prompt, and each one's first
// screen when it has something to ask before it takes input.
func TestAnInputBoxIsRecognisedOnTheRealScreens(t *testing.T) {
	for _, tc := range []struct {
		agent, file string
		want        bool
		showing     string
	}{
		{"claude", "claude-idle", true, ""},
		{"claude", "claude-trust", false, "❯ No, exit"},
		{"codex", "codex-idle", true, ""},
		{"codex", "codex-update", false, "› 1. Update now (runs `npm install -g @openai/codex`)"},
		// An agent's screen is read as that agent's only.
		{"codex", "claude-idle", false, ""},
		{"claude", "codex-idle", false, ""},
		{"opencode", "claude-idle", false, ""},
	} {
		s := screen(t, tc.file)
		if got := AtInputBox(tc.agent, s); got != tc.want {
			t.Errorf("%s on %s: %v, want %v", tc.agent, tc.file, got, tc.want)
		}
		if tc.showing != "" && Showing(s) != tc.showing {
			t.Errorf("%s shows %q, want %q", tc.file, Showing(s), tc.showing)
		}
	}
}

// The shapes the real screens do not cover, each one edit away from an input
// box.
func TestWhatIsNotAnInputBox(t *testing.T) {
	rule := strings.Repeat("─", 80)
	for _, tc := range []struct {
		name, agent, screen string
	}{
		{"nothing drawn yet", "claude", ""},
		{"a numbered menu between rules", "claude", rule + "\n❯ 1. Yes\n" + rule + "\n"},
		{"no rule below", "claude", rule + "\n❯ Try something\n  2. Something else\n"},
		{"a short divider is not a rule", "claude", "────\n❯ Try something\n────\n"},
		{"a cursor at the very bottom", "claude", rule + "\n❯ Try something"},
		{"a menu above the shortcuts hint", "codex", "› 1. Yes\n  2. No\n  ? for shortcuts\n"},
		{"the hint above the cursor", "codex", "  ? for shortcuts\n› Ask Codex to do anything\n"},
		{"no hint", "codex", "› Ask Codex to do anything\n"},
	} {
		if AtInputBox(tc.agent, tc.screen) {
			t.Errorf("%s: read as an input box", tc.name)
		}
	}
	// And the positive control for the synthetic rule, so the cases above are
	// not passing because nothing ever matches.
	if !AtInputBox("claude", rule+"\n❯ Try something\n"+rule+"\n  footer\n") {
		t.Fatal("the plain prompt shape was not recognised")
	}
}
