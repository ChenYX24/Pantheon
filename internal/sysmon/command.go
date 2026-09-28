package sysmon

import (
	"path"
	"strings"
	"unicode/utf8"
)

// cmdMax bounds a command line in a reading. The monitor shows one line of it,
// and an argv can be megabytes: a compiler handed every file in a package.
const cmdMax = 200

// displayCommand is argv as one line a person can recognise.
//
// Mostly the arguments joined by spaces, cut at cmdMax. One shape is rewritten,
// because it is most of what an agent runs: Claude Code runs every command as
//
//	/bin/bash -c "source <snapshot> ... && eval '<the command>' && pwd -P >| <file>"
//
// so the part a person typed, or the agent chose, is the quoted argument of
// the eval, and without this every row of an agent's session reads "bash -c
// source /home/…/shell-snapshots/…". The eval is only taken when it parses as
// a single shell word; anything else is shown as it is.
func displayCommand(argv []string) string {
	if len(argv) == 0 {
		return ""
	}
	if inner, ok := evalCommand(argv); ok {
		return clip(inner)
	}
	return clip(strings.Join(argv, " "))
}

// CommandOf is displayCommand for a running process, or "" for one that has
// gone or has no argv (a kernel thread).
func CommandOf(pid int) string {
	return displayCommand(readCmdline(pid))
}

func evalCommand(argv []string) (string, bool) {
	if len(argv) < 3 || argv[1] != "-c" {
		return "", false
	}
	switch path.Base(argv[0]) {
	case "bash", "sh", "zsh":
	default:
		return "", false
	}
	script := argv[2]
	if !strings.Contains(script, "shell-snapshots/") {
		return "", false
	}
	at := strings.Index(script, " eval ")
	if at < 0 {
		return "", false
	}
	word, ok := shellWord(script[at+len(" eval "):])
	if !ok || strings.TrimSpace(word) == "" {
		return "", false
	}
	return word, true
}

// shellWord reads one POSIX shell word from the start of s, made of adjacent
// single- and double-quoted parts and bare characters, up to the first
// unquoted blank. Only what that wrapper produces is supported: backslash
// escapes inside double quotes, none inside single quotes.
func shellWord(s string) (string, bool) {
	var b strings.Builder
	i := 0
	for i < len(s) {
		switch c := s[i]; {
		case c == '\'':
			end := strings.IndexByte(s[i+1:], '\'')
			if end < 0 {
				return "", false
			}
			b.WriteString(s[i+1 : i+1+end])
			i += end + 2
		case c == '"':
			j := i + 1
			for ; j < len(s) && s[j] != '"'; j++ {
				if s[j] == '\\' && j+1 < len(s) {
					j++
				}
				b.WriteByte(s[j])
			}
			if j >= len(s) {
				return "", false
			}
			i = j + 1
		case c == ' ' || c == '\t' || c == '\n':
			return b.String(), true
		default:
			b.WriteByte(c)
			i++
		}
	}
	return b.String(), true
}

// clip is one line of at most cmdMax runes. Newlines become spaces: a script
// passed with -c is often several lines, and the monitor's row is one.
func clip(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= cmdMax {
		return s
	}
	r := []rune(s)
	return string(r[:cmdMax-1]) + "…"
}
