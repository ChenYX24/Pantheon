package rollover

import (
	"regexp"
	"strings"
)

// Where a handoff message may be typed.
//
// A replacement is handed its message by pasting it and pressing Enter, so
// whatever the new agent shows first receives that Enter. On /dev (2026-10-22)
// that was Codex's startup menu, "Update available … › 1. Update now", and the
// Enter ran `npm install -g @openai/codex` for the whole machine. Claude's
// first screen in a folder it has not seen is the same shape, and its
// highlighted answer is "No, exit".
//
// "Drawn and then still" and a hook's waiting/done are true of a menu too, so
// readiness also asks for the agent's own input box at the bottom of the
// screen. Recognised by shape rather than by a list of dialogs, because the
// dialogs nobody has met yet are the ones a list would miss. Strict on
// purpose: a box not recognised costs a handoff that fails with the old
// session still running, and a menu taken for a box costs whatever its
// default does.
//
// testdata holds the screens this was written against, captured from the real
// agents (Claude Code 2.1.310, Codex 0.163.0) at 160×35 with the panel's tmux
// configuration.

// menuItem is a numbered choice. Both agents draw their menu cursor with the
// same character as their prompt, so "❯ 1. Yes" and "› 1. Update now" would
// otherwise read as an input box with something typed in it.
var menuItem = regexp.MustCompile(`^\d+\.\s`)

// AtInputBox reports whether an agent's visible screen ends at its own empty
// or placeholder input box. screen is plain text, without SGR sequences.
func AtInputBox(agent, screen string) bool {
	lines := screenLines(screen)
	switch agent {
	case "claude":
		return claudeBox(lines, lastCursor(lines, "❯"))
	case "codex":
		// Codex draws `› ` and its placeholder, with its status line and
		// "? for shortcuts" below. A menu has neither underneath it.
		i := lastCursor(lines, "›")
		if i < 0 || menuItem.MatchString(after(lines[i])) {
			return false
		}
		for _, l := range lines[i+1:] {
			if strings.Contains(l, "? for shortcuts") || strings.Contains(l, "context left") {
				return true
			}
		}
	}
	return false
}

// claudeBox reports whether line i is Claude Code's prompt, which it draws
// between two full-width rules:
//
//	──────────────
//	❯ Try "fix typecheck errors"
//	──────────────
//
// Its dialogs put text, not a rule, directly above their cursor line.
func claudeBox(lines []string, i int) bool {
	return i > 0 && i+1 < len(lines) && isRule(lines[i-1]) && isRule(lines[i+1]) &&
		!menuItem.MatchString(after(lines[i]))
}

// Showing names what a screen is showing, for the reason a handoff failed:
// the line a menu has highlighted when there is one, because that is what an
// Enter would have chosen, and otherwise the last line with anything on it.
func Showing(screen string) string {
	lines := screenLines(screen)
	for _, cursor := range []string{"❯", "›"} {
		if i := lastCursor(lines, cursor); i >= 0 && !claudeBox(lines, i) {
			return clip(strings.TrimSpace(lines[i]))
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		if t := strings.TrimSpace(lines[i]); t != "" && !isRule(t) {
			return clip(t)
		}
	}
	return ""
}

func screenLines(screen string) []string {
	lines := strings.Split(strings.ReplaceAll(screen, "\r", ""), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " ")
	}
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// lastCursor is the bottom-most line that starts with cursor, the agent's
// prompt or menu marker, or -1.
func lastCursor(lines []string, cursor string) int {
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.HasPrefix(strings.TrimLeft(lines[i], " "), cursor) {
			return i
		}
	}
	return -1
}

// after is what follows a cursor line's marker.
func after(line string) string {
	t := []rune(strings.TrimLeft(line, " "))
	return strings.TrimSpace(string(t[1:]))
}

// isRule is a line of box-drawing horizontals and nothing else, long enough
// not to be a short divider inside somebody's output.
func isRule(line string) bool {
	t := strings.TrimSpace(line)
	return len([]rune(t)) >= 20 && strings.Trim(t, "─") == ""
}

func clip(s string) string {
	if r := []rune(s); len(r) > 100 {
		return string(r[:100]) + "…"
	}
	return s
}
