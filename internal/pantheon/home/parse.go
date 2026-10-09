package home

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var activeBullet = regexp.MustCompile(`^- \*\*([^*]+)\*\*\s*[:：]\s*(.*)$`)
var markdownLink = regexp.MustCompile(`\[([^\]]*)\]\(([^)]+)\)`)

func ParseActiveContext(data []byte) ActiveContext {
	out := ActiveContext{ActiveDocs: []Link{}, Blockers: []string{}}
	for _, line := range strings.Split(string(data), "\n") {
		m := activeBullet.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m == nil {
			continue
		}
		value := trimChars(markdownLink.ReplaceAllString(m[2], "$1"), 600)
		switch strings.ToLower(strings.TrimSpace(m[1])) {
		case "goal", "目标":
			out.Goal = value
		case "active plan", "活动文档":
			for _, link := range markdownLink.FindAllStringSubmatch(m[2], -1) {
				out.ActiveDocs = append(out.ActiveDocs, Link{trimChars(link[1], 600), strings.TrimSpace(link[2])})
			}
		case "last verified commit", "已验证基线", "最后验证":
			out.LastVerified = value
		case "blockers", "阻塞":
			if value != "" {
				out.Blockers = append(out.Blockers, value)
			}
		}
	}
	return out
}

func trimChars(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

func capBytes(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	for !utf8.RuneStart(value[limit]) {
		limit--
	}
	return value[:limit]
}

type frontmatter struct {
	values  map[string]string
	lines   [][]byte
	end     int
	newline string
	body    []byte
}

// Keep the original lines as well as the values: serializing a YAML map would
// change comments, ordering and the user's markdown on a status-only edit.
func parseFrontmatter(data []byte) (frontmatter, error) {
	f := frontmatter{values: map[string]string{}, lines: bytes.SplitAfter(data, []byte("\n")), newline: "\n"}
	if strings.TrimRight(string(f.lines[0]), "\r\n") != "---" {
		return f, errors.New("missing frontmatter")
	}
	if bytes.HasSuffix(f.lines[0], []byte("\r\n")) {
		f.newline = "\r\n"
	}
	for i := 1; i < len(f.lines); i++ {
		line := strings.TrimRight(string(f.lines[i]), "\r\n")
		if line == "---" {
			f.end = i
			f.body = bytes.Join(f.lines[i+1:], nil)
			return f, nil
		}
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		key = strings.TrimSpace(key)
		if !ok || key == "" {
			return f, fmt.Errorf("invalid frontmatter line %d", i+1)
		}
		if _, exists := f.values[key]; exists {
			return f, fmt.Errorf("duplicate frontmatter key %s", key)
		}
		f.values[key] = scalar(value)
	}
	return f, errors.New("unclosed frontmatter")
}

func scalar(value string) string {
	value = strings.TrimSpace(value)
	quote := byte(0)
	escaped := false
	for i := 0; i < len(value); i++ {
		c := value[i]
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' && quote == '"' {
			escaped = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			}
		} else if c == '\'' || c == '"' {
			quote = c
		} else if c == '#' && (i == 0 || value[i-1] == ' ' || value[i-1] == '\t') {
			value = strings.TrimSpace(value[:i])
			break
		}
	}
	if unquoted, err := strconv.Unquote(value); err == nil {
		return unquoted
	}
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		return strings.ReplaceAll(value[1:len(value)-1], "''", "'")
	}
	return value
}

func list(value string) ([]string, error) {
	out := []string{}
	if value == "" {
		return out, nil
	}
	if !strings.HasPrefix(value, "[") || !strings.HasSuffix(value, "]") {
		return out, errors.New("depends_on must be a bracketed list")
	}
	for _, item := range strings.Split(value[1:len(value)-1], ",") {
		item = scalar(item)
		if item != "" {
			if !taskID.MatchString(item) {
				return out, errors.New("invalid dependency id")
			}
			out = append(out, item)
		}
	}
	return out, nil
}

func parseTask(data []byte, id, file string, mtime time.Time) (Task, []string, error) {
	f, err := parseFrontmatter(data)
	if err != nil {
		return Task{}, nil, err
	}
	v := f.values
	if !taskID.MatchString(id) || v["id"] != id {
		return Task{}, nil, errors.New("task id must match its directory")
	}
	depends, err := list(v["depends_on"])
	if err != nil {
		return Task{}, nil, err
	}
	tags, err := stringList(v["tags"])
	if err != nil {
		return Task{}, nil, fmt.Errorf("tags: %w", err)
	}
	t := Task{Priority: v["priority"], Tags: tags, Owner: v["owner"], Due: v["due"], ID: id, Title: v["title"], Status: v["status"], Stage: v["stage"], Primary: v["primary"], Secondary: v["secondary"], DependsOn: depends, Session: v["session"], BlockedReason: v["blocked_reason"], SessionStatus: v["session_status"], Updated: v["updated"], Body: string(f.body), Rev: Revision(data), File: file, mtime: mtime}
	warnings := []string{}
	if !ValidStatus(t.Status) {
		warnings = append(warnings, "unknown status; treated as planned")
		t.Status = "planned"
	}
	if t.SessionStatus == "" {
		t.SessionStatus = "ok"
	}
	if t.SessionStatus != "ok" && t.SessionStatus != "rollover_due" {
		warnings = append(warnings, "unknown session_status; treated as ok")
		t.SessionStatus = "ok"
	}
	for _, assignment := range []string{t.Primary, t.Secondary} {
		if !validAssignment(assignment) {
			warnings = append(warnings, "executor must be <harness>/<model>")
		}
	}
	if t.Updated != "" {
		if _, err := time.Parse(time.RFC3339, t.Updated); err != nil {
			warnings = append(warnings, "invalid updated timestamp; using file mtime for ordering")
		}
	}
	return t, warnings, nil
}

func validAssignment(value string) bool {
	if value == "" {
		return true
	}
	harness, model, ok := strings.Cut(value, "/")
	return ok && strings.TrimSpace(harness) != "" && strings.TrimSpace(model) != "" && !strings.ContainsAny(value, "\r\n")
}

func parseReport(data []byte, file string, mtime time.Time) (Report, []string, error) {
	f, err := parseFrontmatter(data)
	if err != nil {
		return Report{}, nil, err
	}
	v := f.values
	r := Report{ReportSummary: ReportSummary{File: file, Title: v["title"], Summary: v["summary"], Kind: v["kind"]}, Task: v["task"], Body: capBytes(string(f.body), 16<<10), Rev: Revision(data), at: mtime}
	warnings := []string{}
	if r.Kind != "report" && r.Kind != "question" {
		return r, warnings, errors.New("kind must be report or question")
	}
	if v["needs_user"] != "" {
		r.NeedsUser, err = strconv.ParseBool(v["needs_user"])
		if err != nil {
			return r, warnings, errors.New("needs_user must be true or false")
		}
	}
	if v["at"] != "" {
		if at, err := time.Parse(time.RFC3339, v["at"]); err == nil {
			r.at = at
		} else {
			warnings = append(warnings, "invalid at timestamp; using file mtime")
		}
	}
	r.Replies = reportReplies(string(f.body))
	r.At = r.at.Format(time.RFC3339Nano)
	return r, warnings, nil
}
