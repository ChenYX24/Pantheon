package agentctx

import (
	"strings"
	"testing"
	"time"
)

// A token_count as Codex 0.164.0 writes it for a Pro login on this machine:
// one seven-day window as primary, no secondary, credits beside it.
const codexCount = `{"timestamp":"2026-10-25T14:40:01.000Z","type":"event_msg","payload":{"type":"token_count","info":%s,"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":4.0,"window_minutes":10080,"resets_at":1793523155},"secondary":null,"credits":{"has_credits":true,"unlimited":false,"balance":"62500.0000000000"},"individual_limit":null,"spend_control_reached":null,"plan_type":"pro","rate_limit_reached_type":null}}}`

const codexInfo = `{"last_token_usage":{"input_tokens":41000},"model_context_window":258400}`

func limitsLine(info string) string {
	return strings.Replace(codexCount, "%s", info, 1) + "\n"
}

func TestCodexLimitsAreReadFromTheTokenCount(t *testing.T) {
	u := ScanCodex(strings.NewReader(limitsLine(codexInfo)), Usage{})
	if u.Used != 41000 || u.Quota == nil {
		t.Fatalf("%+v", u)
	}
	q := *u.Quota
	if q.Plan != "pro" || q.Source != Codex || len(q.Limits) != 1 || q.Limits[0] != (Limit{Minutes: 10080, Used: 4, ResetsAt: 1793523155}) {
		t.Fatalf("%+v", q)
	}
	if want := time.Date(2026, 10, 25, 14, 40, 1, 0, time.UTC); !q.At.Equal(want) {
		t.Fatalf("at %v", q.At)
	}
}

// The first token_count of a conversation has limits and no context yet, and
// a later one may have context and no limits: neither may cost the other.
func TestCodexLimitsSurviveTheReadingsWithoutThem(t *testing.T) {
	u := ScanCodex(strings.NewReader(limitsLine("null")), Usage{})
	if u.Source != "" || u.Quota == nil || u.Quota.Limits[0].Used != 4 {
		t.Fatalf("limits before any context: %+v", u)
	}
	plain := `{"type":"event_msg","payload":{"type":"token_count","info":` + codexInfo + `,"rate_limits":null}}` + "\n"
	u = ScanCodex(strings.NewReader(plain), u)
	if u.Used != 41000 || u.Quota == nil || u.Quota.Limits[0].Used != 4 {
		t.Fatalf("context reading dropped the limits: %+v", u)
	}
}

func TestCodexLimitsThatAreNotTheGeneralOneOrNotNumbersAreIgnored(t *testing.T) {
	for name, line := range map[string]string{
		"another bucket": strings.Replace(limitsLine(codexInfo), `"limit_id":"codex"`, `"limit_id":"codex_other_model"`, 1),
		"negative":       strings.Replace(limitsLine(codexInfo), `"used_percent":4.0`, `"used_percent":-1`, 1),
		"no window":      strings.Replace(limitsLine(codexInfo), `"window_minutes":10080`, `"window_minutes":0`, 1),
		"a year window":  strings.Replace(limitsLine(codexInfo), `"window_minutes":10080`, `"window_minutes":525600`, 1),
		"not a number":   strings.Replace(limitsLine(codexInfo), `"used_percent":4.0`, `"used_percent":"4"`, 1),
	} {
		if u := ScanCodex(strings.NewReader(line), Usage{}); u.Quota != nil {
			t.Errorf("%s: %+v", name, *u.Quota)
		}
	}
}

func TestCodexWindowsAreShortestFirst(t *testing.T) {
	line := strings.Replace(limitsLine(codexInfo), `"secondary":null`, `"secondary":{"used_percent":61.4,"window_minutes":300,"resets_at":1793040000}`, 1)
	u := ScanCodex(strings.NewReader(line), Usage{})
	if u.Quota == nil || len(u.Quota.Limits) != 2 || u.Quota.Limits[0].Minutes != 300 || u.Quota.Limits[0].Used != 61 || u.Quota.Limits[1].Minutes != 10080 {
		t.Fatalf("%+v", u.Quota)
	}
}

// What Claude Code 2.1.310 piped to a status line command on a Max login,
// after one reply, trimmed to the fields around the limits.
const claudeStatus = `{"session_id":"x","model":{"id":"claude-opus-5-5","display_name":"Opus 5.5"},"context_window":{"used_percentage":4},"rate_limits":{"five_hour":{"used_percentage":0,"resets_at":1793037000},"seven_day":{"used_percentage":7,"resets_at":1793062800}}}`

func TestClaudeLimitsAreReadFromTheStatusLine(t *testing.T) {
	at := time.Unix(1793030000, 0)
	q, ok := ClaudeLimits([]byte(claudeStatus), at)
	if !ok || q.Source != ClaudeStatusLine || !q.At.Equal(at) || len(q.Limits) != 2 ||
		q.Limits[0] != (Limit{Minutes: 300, Used: 0, ResetsAt: 1793037000}) ||
		q.Limits[1] != (Limit{Minutes: 10080, Used: 7, ResetsAt: 1793062800}) {
		t.Fatalf("%v %+v", ok, q)
	}
}

func TestClaudeDocumentsWithoutUsableLimitsAreNotReadings(t *testing.T) {
	for name, doc := range map[string]string{
		// An API-billed login: the same document with no rate_limits at all.
		"api billing": `{"session_id":"x","context_window":{"used_percentage":4}}`,
		"empty":       `{"rate_limits":{}}`,
		"only spend":  `{"rate_limits":{"spend_limit":{"used_percentage":40,"resets_at":1793037000}}}`,
		"negative":    strings.Replace(claudeStatus, `"used_percentage":7`, `"used_percentage":-7`, 1),
		"far reset":   strings.Replace(claudeStatus, `"resets_at":1793062800`, `"resets_at":99999999999`, 1),
		"not JSON":    `rate_limits`,
	} {
		if q, ok := ClaudeLimits([]byte(doc), time.Now()); ok {
			t.Errorf("%s: %+v", name, q)
		}
	}
	if _, ok := ClaudeLimits([]byte(`{"rate_limits":{"five_hour":{"used_percentage":112}}}`), time.Now()); !ok {
		t.Error("an exceeded window with no reset time is still a reading")
	}
}

func TestSameIgnoresOnlyTheTime(t *testing.T) {
	a, _ := ClaudeLimits([]byte(claudeStatus), time.Unix(1, 0))
	b, _ := ClaudeLimits([]byte(claudeStatus), time.Unix(2, 0))
	if !a.Same(b) {
		t.Fatal("same figures at another time differ")
	}
	c, _ := ClaudeLimits([]byte(strings.Replace(claudeStatus, `"used_percentage":7`, `"used_percentage":8`, 1)), time.Unix(1, 0))
	if a.Same(c) {
		t.Fatal("a moved figure is the same")
	}
}
