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
				Model string `json:"model"`
				Usage *struct {
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
		last = Usage{Used: u.Input + u.Read + u.Creation, Window: ClaudeWindow(e.Message.Model), Model: e.Message.Model, Source: Claude, At: at}
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
			} `json:"payload"`
		}
		if json.Unmarshal(line, &e) != nil || e.Type != "event_msg" || e.Payload.Type != "token_count" || e.Payload.Info == nil {
			return
		}
		i := e.Payload.Info
		if i.Last == nil || i.Last.Input < 0 || i.Window < 0 {
			return
		}
		at, _ := time.Parse(time.RFC3339Nano, e.Timestamp)
		last = Usage{Used: i.Last.Input, Window: i.Window, Source: Codex, At: at}
	})
	return last
}
