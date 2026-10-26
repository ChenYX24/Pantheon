// Package agentctx reads the latest context usage, not cumulative token spend.
package agentctx

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"math"
	"regexp"
	"strings"
	"time"
)

const (
	Claude = "claude-transcript"
	Codex  = "codex-rollout"
)

type Usage struct {
	Used   int64     `json:"used"`
	Window int64     `json:"window"`
	Model  string    `json:"model"`
	Source string    `json:"source"`
	At     time.Time `json:"at"`
	// TurnEnded: the last main-chain assistant entry has stop_reason
	// "end_turn", so the agent finished and is waiting for the person. It is
	// what a Claude with no hooks installed has instead of a Stop report.
	//
	// Not serialised. It is read by the rollover boundary only, and a field in
	// the snapshot would be one more thing every open tab is sent a new copy
	// of each time a turn ends.
	TurnEnded bool `json:"-"`

	// Quota is the subscription's windows from the same Codex token_count,
	// nil when none has been read. Not serialised here: a quota belongs to an
	// account, and the snapshot sends it per account, not once per session.
	Quota *Quota `json:"-"`
}

var datedModel = regexp.MustCompile(`-\d{8}$`)
var oldModel = regexp.MustCompile(`^claude-((opus|sonnet|haiku)-(4-(5|1|0)|3(-[0-9]+)?)|3(-[0-9]+)?-(opus|sonnet|haiku))$`)

// ClaudeWindow must be updated when models change. Unknown names keep their
// token count without inventing a denominator or a misleading percentage.
func ClaudeWindow(model string) int64 {
	if strings.Contains(strings.ToLower(model), "[1m]") {
		return 1_000_000
	}
	model = datedModel.ReplaceAllString(model, "")
	switch model {
	case "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
		"claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-5-5",
		"claude-fable-5-1", "claude-fable-5", "claude-mythos-5-1":
		return 1_000_000
	case "claude-opus-4", "claude-sonnet-4":
		return 200_000
	}
	if oldModel.MatchString(model) {
		return 200_000
	}
	return 0
}

// scanLines ignores an unfinished final line and skips oversized lines without
// losing the short usage event after them. Tool output can be megabytes long.
func scanLines(r io.Reader, marker []byte, visit func([]byte)) {
	br := bufio.NewReaderSize(r, 64<<10)
	var line []byte
	skipping := false
	for {
		part, err := br.ReadSlice('\n')
		if !skipping {
			if len(line)+len(part) > maxRead {
				line, skipping = nil, true
			} else {
				line = append(line, part...)
			}
		}
		if err == nil {
			if !skipping && bytes.Contains(line, marker) {
				visit(line)
			}
			line, skipping = line[:0], false
		} else if err != bufio.ErrBufferFull {
			return
		}
	}
}

// ScanClaude returns the last main-chain assistant usage written in r.
func ScanClaude(r io.Reader, last Usage) Usage {
	scanLines(r, []byte(`"usage"`), func(line []byte) {
		var e struct {
			Type        string `json:"type"`
			IsSidechain bool   `json:"isSidechain"`
			Timestamp   string `json:"timestamp"`
			Message     struct {
				Model      string `json:"model"`
				StopReason string `json:"stop_reason"`
				Usage      *struct {
					Input    int64 `json:"input_tokens"`
					Read     int64 `json:"cache_read_input_tokens"`
					Creation int64 `json:"cache_creation_input_tokens"`
				} `json:"usage"`
			} `json:"message"`
		}
		if json.Unmarshal(line, &e) != nil || e.Type != "assistant" || e.IsSidechain || e.Message.Usage == nil {
			return
		}
		u := e.Message.Usage
		if u.Input < 0 || u.Read < 0 || u.Creation < 0 || u.Input > math.MaxInt64-u.Read || u.Input+u.Read > math.MaxInt64-u.Creation {
			return
		}
		at, _ := time.Parse(time.RFC3339Nano, e.Timestamp)
		last = Usage{Used: u.Input + u.Read + u.Creation, Window: ClaudeWindow(e.Message.Model), Model: e.Message.Model, Source: Claude, At: at,
			// Tool calls are written as stop_reason "tool_use", so only the
			// reply that ends a turn sets this, and any later assistant entry
			// clears it. A prompt typed after it writes no assistant entry for
			// a moment; the rollover's input and quiet gates cover that gap.
			TurnEnded: e.Message.StopReason == "end_turn"}
	})
	return last
}

// ScanCodex returns the last token_count with non-null info, never the total
// spent over the conversation. Cached input is already a subset of input_tokens
// in Codex's accounting; adding it again would count that context twice.
func ScanCodex(r io.Reader, last Usage) Usage {
	scanLines(r, []byte(`"token_count"`), func(line []byte) {
		var e struct {
			Type      string `json:"type"`
			Timestamp string `json:"timestamp"`
			Payload   struct {
				Type string `json:"type"`
				Info *struct {
					Last *struct {
						Input int64 `json:"input_tokens"`
					} `json:"last_token_usage"`
					Window int64 `json:"model_context_window"`
				} `json:"info"`
				Limits json.RawMessage `json:"rate_limits"`
			} `json:"payload"`
		}
		if json.Unmarshal(line, &e) != nil || e.Type != "event_msg" || e.Payload.Type != "token_count" {
			return
		}
		at, _ := time.Parse(time.RFC3339Nano, e.Timestamp)
		// Limits arrive on token_counts whose info is null too (the first of a
		// conversation), so they are read before the context gate below, and
		// carried across the context readings that do not repeat them.
		if q, ok := codexLimits(e.Payload.Limits, at); ok {
			last.Quota = q
		}
		i := e.Payload.Info
		if i == nil || i.Last == nil || i.Last.Input < 0 || i.Window < 0 {
			return
		}
		last = Usage{Used: i.Last.Input, Window: i.Window, Source: Codex, At: at, Quota: last.Quota}
	})
	return last
}
