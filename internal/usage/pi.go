package usage

import (
	"bytes"
	"encoding/json"
	"io"
	"time"
)

// ─── pi ───────────────────────────────────────────────────────────────────

// piRecord is the part of one pi session line this cares about.
//
// pi writes one JSON object per line: a session header, then a tree of
// messages, model changes, compactions and branch summaries. Usage appears in
// three shapes and the decoder keeps them flat on purpose:
//
//   - a `message` carries `message.usage`, the call that produced it;
//   - a `compaction` and a `branch_summary` carry a top-level `usage`, the
//     call that generated the summary.
//
// The trap is `retainedTail`, which a compaction embeds: it is an array of
// *copies* of earlier messages, each with the usage object it was first
// written with. Decoding the line as a struct simply cannot see into it, while
// any reader that walked the JSON tree "to find usage anywhere" would add the
// whole retained conversation again on every compaction. Usage is only ever
// read from the two fields above.
type piRecord struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	// Session header fields.
	ID  string `json:"id"`
	CWD string `json:"cwd"`
	// Top-level usage: the summary calls on compaction and branch_summary.
	Usage *piUsage `json:"usage"`
	// The message's own usage and model. `provider` and `api` are deliberately
	// not decoded: the model string is what reaches the dashboard, and it is
	// the same string whether the call went through a provider or a harness.
	Message struct {
		Model string   `json:"model"`
		Usage *piUsage `json:"usage"`
	} `json:"message"`
}

type piUsage struct {
	Input      int64 `json:"input"`
	Output     int64 `json:"output"`
	CacheRead  int64 `json:"cacheRead"`
	CacheWrite int64 `json:"cacheWrite"`
	// Reasoning is decoded rather than dropped so the field cannot be mistaken
	// for absent, but it is not added to Output. pi fills it from
	// `output_tokens_details.thinking_tokens`, and thinking tokens are already
	// inside `completion_tokens`/`output` — the same relationship opencode's
	// disjoint `reasoning` column does *not* have, which is why readOpencode
	// folds and this does not. pi's own `totalTokens` is
	// input+output+cacheRead+cacheWrite, which is the check: the panel must
	// not report more than the agent wrote down.
	Reasoning   int64 `json:"reasoning"`
	TotalTokens int64 `json:"totalTokens"`
}

// The session header carries the id and cwd every bucket needs and no usage
// at all, so the cheap gate has to let it through: a prefilter that only
// looked for `"usage"` skipped the header, and every row then belonged to a
// session called "" in a directory called "". The marker is the literal
// `"type":"session"`; pi writes compact JSON, and a false positive costs one
// decode.
var piSessionMarker = []byte(`"type":"session"`)

func containsPiMarker(line []byte) bool {
	return bytes.Contains(line, usageMarker) || bytes.Contains(line, piSessionMarker)
}

// readPi accumulates one pi session file.
//
// Files live at <root>/<cwd-slug>/<timestamp>_<session-uuid>.jsonl and every
// number here was written by pi at the time of the call. There is nothing to
// difference and nothing to deduplicate: each persisted message is one API
// response, and a response is written once. The one counting mistake available
// is described on piRecord (retainedTail), and the decoder makes it
// unexpressible rather than tested for.
//
// A known limit, stated rather than hidden: pi can fork or clone a session
// (`parentSession` on the header). These files are counted as their own
// sessions, because that is what they are to pi, but if a clone copies the
// parent's usage-bearing entries into the new file those calls are counted
// once in each file. The cursor is per file and cannot see the relationship,
// and the alternative — inventing a cross-file dedupe key from (message id,
// usage) — would also silently discard a genuinely repeated call. None of
// this was observable in the corpus this was written against (9 sessions, no
// forked headers), so it is a limit and not a fix.
func readPi(r io.Reader, loc *time.Location) (readResult, error) {
	var out readResult
	agg := map[key]*Bucket{}

	var session, cwd, model string

	err := eachLine(r, &out.skipped, func(line []byte) {
		if !containsPiMarker(line) {
			return
		}
		var rec piRecord
		if err := json.Unmarshal(line, &rec); err != nil {
			out.skipped++
			return
		}
		switch rec.Type {
		case "session":
			session, cwd = rec.ID, rec.CWD
			return
		case "message":
			if rec.Message.Usage == nil {
				return
			}
			// The model travels with the message, so a session that switched
			// models is attributed per response rather than to whatever it
			// started with.
			if rec.Message.Model != "" {
				model = rec.Message.Model
			}
			addPi(agg, &out, rec, loc, session, cwd, model, rec.Message.Usage)
			return
		case "compaction", "branch_summary":
			// The summary call is spend like any other. It carries no model of
			// its own, so it is attributed to the model last seen, which is
			// the one that was active when the summary was generated.
			if rec.Usage == nil {
				return
			}
			addPi(agg, &out, rec, loc, session, cwd, model, rec.Usage)
			return
		}
	})
	if err != nil {
		return out, err
	}
	out.buckets = flatten(agg)
	return out, nil
}

func addPi(agg map[key]*Bucket, out *readResult, rec piRecord,
	loc *time.Location, session, cwd, model string, u *piUsage) {
	day, ok := localDay(rec.Timestamp, loc)
	if !ok {
		out.skipped++
		return
	}
	c := Counts{
		Input:      u.Input,
		Output:     u.Output,
		CacheRead:  u.CacheRead,
		CacheWrite: u.CacheWrite,
	}
	if c.Total() == 0 {
		// An aborted or refused turn: a usage object that spent nothing. Not
		// a request either -- there was no call.
		return
	}
	c.Requests = 1
	add(agg, key{day, session, model}, cwd, c)
}
