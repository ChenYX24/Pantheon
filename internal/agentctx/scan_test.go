package agentctx

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"
)

func claudeLine(used int64) string {
	return fmt.Sprintf(`{"type":"assistant","isSidechain":false,"message":{"model":"claude-opus-5-5","usage":{"input_tokens":%d,"cache_read_input_tokens":200,"cache_creation_input_tokens":300,"output_tokens":9999}},"timestamp":"2026-10-16T01:02:03Z"}`+"\n", used)
}

func codexLine(used int64) string {
	return fmt.Sprintf(`{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":%d,"cached_input_tokens":9000,"output_tokens":500,"reasoning_output_tokens":700,"total_tokens":999999},"total_token_usage":{"input_tokens":999999},"model_context_window":258400}},"timestamp":"2026-10-16T01:02:03Z"}`+"\n", used)
}

func TestClaudeScanner(t *testing.T) {
	main := claudeLine(12_000)
	side := strings.Replace(claudeLine(900_000), `"isSidechain":false`, `"isSidechain":true`, 1)
	user := strings.Replace(claudeLine(800_000), `"type":"assistant"`, `"type":"user"`, 1)
	input := claudeLine(600_000) + "not even json\n" + `{"type":"assistant","message":{"content":"tool output"}}` + "\n" + main + side + user + strings.TrimSuffix(claudeLine(700_000), "\n")
	u := ScanClaude(strings.NewReader(input), Usage{})
	if u.Used != 12_500 || u.Window != 1_000_000 || u.Model != "claude-opus-5-5" || u.Source != Claude || !u.At.Equal(time.Date(2026, 10, 16, 1, 2, 3, 0, time.UTC)) {
		t.Fatalf("latest main-chain usage = %+v", u)
	}
	if got := ScanClaude(strings.NewReader(side+`{"message":{"usage":null}}`+"\n"), u); got != u {
		t.Fatalf("irrelevant lines replaced usage: %+v", got)
	}
	if got := ScanClaude(strings.NewReader(claudeLine(-1)), Usage{}); got.Source != "" {
		t.Fatalf("accepted negative input: %+v", got)
	}
}

func TestClaudeModelWindows(t *testing.T) {
	for _, model := range []string{
		"claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
		"claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-5-5",
		"claude-fable-5-1", "claude-fable-5", "claude-mythos-5-1", "claude-sonnet-4-5[1m]", "custom[1m]",
	} {
		t.Run(model, func(t *testing.T) {
			if got := ClaudeWindow(model); got != 1_000_000 {
				t.Fatalf("window = %d", got)
			}
		})
	}
	for _, tc := range []struct {
		model string
		want  int64
	}{
		{"claude-haiku-4-5", 200_000}, {"claude-opus-4-5", 200_000}, {"claude-sonnet-4-5-20250929", 200_000},
		{"claude-opus-4-1", 200_000}, {"claude-sonnet-4-0", 200_000}, {"claude-opus-4-20250514", 200_000},
		{"claude-3-5-sonnet-20241022", 200_000}, {"claude-3-opus-20240229", 200_000}, {"claude-haiku-3-5", 200_000},
		{"unknown", 0}, {"", 0}, {"claude-opus-5-50", 0}, {"claude-haiku-5", 0}, {"claude-opus-6", 0},
	} {
		t.Run(tc.model, func(t *testing.T) {
			if got := ClaudeWindow(tc.model); got != tc.want {
				t.Fatalf("window = %d, want %d", got, tc.want)
			}
		})
	}
	unknown := strings.Replace(claudeLine(620_000), "claude-opus-5-5", "unknown", 1)
	if got := ScanClaude(strings.NewReader(unknown), Usage{}); got.Window != 0 || got.Used != 620_500 {
		t.Fatalf("unknown model lost its tokens: %+v", got)
	}
}

func TestCodexScanner(t *testing.T) {
	null := `{"type":"event_msg","payload":{"type":"token_count","info":null}}` + "\n"
	u := ScanCodex(strings.NewReader(codexLine(42_000)+null+codexLine(20_000)+null+strings.TrimSuffix(codexLine(1), "\n")), Usage{})
	if u.Used != 20_000 || u.Window != 258_400 || u.Source != Codex || u.Model != "" || u.At.IsZero() {
		t.Fatalf("last event (without double-counting cached input) = %+v", u)
	}
	if got := ScanCodex(strings.NewReader(null), u); got != u {
		t.Fatalf("null info replaced usage: %+v", got)
	}
}

func TestScannersSkipOversizedLines(t *testing.T) {
	large := strings.Repeat("x", maxRead+100) + "\n"
	for _, tc := range []struct {
		name string
		scan func(r io.Reader, last Usage) Usage
		line string
		want int64
	}{
		{"claude", ScanClaude, claudeLine(1000), 1500},
		{"codex", ScanCodex, codexLine(1000), 1000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.scan(strings.NewReader(large+tc.line), Usage{}); got.Used != tc.want {
				t.Fatalf("usage after oversized line = %+v", got)
			}
		})
	}
}

// A Claude with no hooks installed has no Stop report, so the transcript is the
// only place a finished turn is written down. Calls are stop_reason "tool_use";
// only the reply that ends a turn is "end_turn", and anything after clears it.
func TestClaudeTurnEndsWithAnEndTurnReply(t *testing.T) {
	line := func(typ, stop string, side bool) string {
		s := `{"type":"` + typ + `","isSidechain":` + map[bool]string{true: "true", false: "false"}[side] +
			`,"timestamp":"2026-10-20T08:00:00Z","message":{"model":"claude-opus-5-5","stop_reason":"` + stop +
			`","usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":30}}}`
		return s + "\n"
	}
	for _, tc := range []struct {
		name  string
		lines string
		want  bool
	}{
		{"a tool call is not an end", line("assistant", "tool_use", false), false},
		{"an end_turn reply is", line("assistant", "tool_use", false) + line("assistant", "end_turn", false), true},
		{"a later call clears it", line("assistant", "end_turn", false) + line("assistant", "tool_use", false), false},
		// A subagent finishing says nothing about the main conversation.
		{"a sidechain end_turn is ignored", line("assistant", "tool_use", false) + line("assistant", "end_turn", true), false},
		{"a stop_sequence is not an end_turn", line("assistant", "stop_sequence", false), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ScanClaude(strings.NewReader(tc.lines), Usage{})
			if got.TurnEnded != tc.want || got.Used != 60 || got.Source != Claude {
				t.Fatalf("%+v", got)
			}
		})
	}
	if b, _ := json.Marshal(Usage{TurnEnded: true}); strings.Contains(string(b), "urn") {
		t.Fatalf("TurnEnded reached the wire: %s", b)
	}
}
