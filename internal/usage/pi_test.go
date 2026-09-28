package usage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// piSessionHeader is the first line of every pi session file. The id here is
// the agent's own session, which is what every bucket below must carry: the
// per-message `id` is a message id and using it would make one session look
// like a hundred.
func piSessionHeader(ts, session, cwd string) string {
	return fmt.Sprintf(`{"type":"session","version":3,"id":%q,"timestamp":%q,"cwd":%q}`,
		session, ts, cwd)
}

// piAssistant writes one assistant message the way pi writes it, including the
// fields this reader does not use (content, stopReason) so the fixture keeps
// the shape of the real thing.
func piAssistant(ts, msgID, model string, in, out, cr, cw, reasoning, total int64) string {
	return fmt.Sprintf(`{"type":"message","id":%q,"parentId":"p","timestamp":%q,`+
		`"message":{"role":"assistant","content":[{"type":"text","text":"hi"}],`+
		`"api":"openai-completions","provider":"harness","model":%q,`+
		`"usage":{"input":%d,"output":%d,"cacheRead":%d,"cacheWrite":%d,`+
		`"reasoning":%d,"totalTokens":%d,"cost":{"total":0}},`+
		`"stopReason":"stop","timestamp":0}}`,
		msgID, ts, model, in, out, cr, cw, reasoning, total)
}

// TestPiReadsWhatItRecorded pins the four columns against a record copied out
// of a real pi session, including the reasoning relationship that is the one
// thing here that could be got wrong invisibly.
//
// pi fills `reasoning` from OpenAI's `output_tokens_details.thinking_tokens`,
// which is a *breakdown of* `output_tokens`; pi's own `totalTokens` is
// input+output+cacheRead+cacheWrite and does not add it again. Folding
// reasoning into Output the way readOpencode does (where the columns are
// disjoint) would inflate every thinking-heavy session by its reasoning share
// — and nothing would fail, because the number would still look like a
// plausible token count.
func TestPiReadsWhatItRecorded(t *testing.T) {
	// The numbers are the first real assistant response in session
	// 01a0958c, in 262 / out 498 / cacheRead 1280 / reasoning 355.
	const ts = "2026-09-12T12:18:53.834Z"
	body := strings.Join([]string{
		piSessionHeader("2026-09-12T12:16:40.006Z", "01a0958c-603f-77c3-ba69", "/home/agent"),
		`{"type":"model_change","id":"e93eb191","parentId":null,"timestamp":"2026-09-12T12:17:13.744Z","provider":"harness","modelId":"deepseek-flash"}`,
		`{"type":"message","id":"06953566","parentId":"p","timestamp":"2026-09-12T12:18:43.413Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`,
		piAssistant(ts, "af081f40", "claude-opus-4-6-thinking", 262, 498, 1280, 0, 355, 2040),
	}, "\n") + "\n"

	f := read(t, ToolPi, body)
	got := total(f)
	if got.Input != 262 {
		t.Errorf("Input=%d, want 262; pi's input excludes the cached part", got.Input)
	}
	if got.Output != 498 {
		t.Errorf("Output=%d, want 498; reasoning is inside output, not beside it", got.Output)
	}
	if got.CacheRead != 1280 {
		t.Errorf("CacheRead=%d, want 1280", got.CacheRead)
	}
	if got.Requests != 1 {
		t.Errorf("Requests=%d, want 1", got.Requests)
	}
	// The invariant the Codex and opencode readers are held to as well: what
	// the panel reports is what the agent itself last wrote down.
	if got.Total() != 2040 {
		t.Errorf("Total()=%d, want 2040 — pi's own totalTokens", got.Total())
	}
	if len(f.Buckets) != 1 {
		t.Fatalf("buckets=%d, want 1: %+v", len(f.Buckets), f.Buckets)
	}
	b := f.Buckets[0]
	if b.Session != "01a0958c-603f-77c3-ba69" {
		t.Errorf("Session=%q, want the session header's id", b.Session)
	}
	if b.Model != "claude-opus-4-6-thinking" {
		t.Errorf("Model=%q, want the message's model", b.Model)
	}
	if b.CWD != "/home/agent" {
		t.Errorf("CWD=%q, want the session's cwd", b.CWD)
	}
}

// A compaction and a branch summary are API calls too, and pi says so: their
// top-level `usage` is "included in session token and cost totals". The
// retainedTail they can carry is the trap — an array of copies of earlier
// messages, each with the usage object it was first written with. A reader
// that walked the JSON looking for usage anywhere would re-count the retained
// conversation on every compaction and report a multiple of the truth.
func TestPiCountsSummaryCallsButNotTheRetainedTail(t *testing.T) {
	body := strings.Join([]string{
		piSessionHeader("2026-09-12T12:16:40.006Z", "s1", "/p"),
		piAssistant("2026-09-12T12:20:00.000Z", "m1", "claude-opus-4-6-thinking", 100, 10, 0, 0, 0, 110),
		// A compaction: 40 fresh in, 5 out for the summary, plus a retained
		// copy of a 110-token message. The copy is the shape `retainedTail`
		// really holds, and it must not be read as another call.
		`{"type":"compaction","id":"c1","parentId":"m1","timestamp":"2026-09-12T12:30:00.000Z",` +
			`"summary":"...","tokensBefore":50000,"usage":{"input":40,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":45},` +
			`"retainedTail":[{"role":"assistant","model":"claude-opus-4-6-thinking",` +
			`"usage":{"input":100,"output":10,"cacheRead":0,"cacheWrite":0,"totalTokens":110}}]}`,
		fmt.Sprintf(`{"type":"branch_summary","id":"c2","parentId":"c1","timestamp":"2026-09-12T12:40:00.000Z",` +
			`"summary":"...","usage":{"input":7,"output":3,"cacheRead":0,"cacheWrite":0,"totalTokens":10}}`),
	}, "\n") + "\n"

	f := read(t, ToolPi, body)
	got := total(f)
	if got.Input != 147 {
		t.Errorf("Input=%d, want 147 (100 message + 40 compaction + 7 branch); "+
			"the retained tail or a summary call was counted wrong", got.Input)
	}
	if got.Output != 18 {
		t.Errorf("Output=%d, want 18 (10+5+3)", got.Output)
	}
	if got.Requests != 3 {
		t.Errorf("Requests=%d, want 3", got.Requests)
	}
	// The summary entries carry no model; they belong to the model last seen,
	// not to the empty string.
	for _, b := range f.Buckets {
		if b.Model != "claude-opus-4-6-thinking" {
			t.Errorf("bucket %+v: summaries did not inherit the last model", b)
		}
	}
}

// A usage object that spent nothing is an aborted or refused turn: no tokens
// and no request. Counting it would put a request on the chart for a call that
// never happened.
func TestPiZeroUsageIsNotARequest(t *testing.T) {
	body := strings.Join([]string{
		piSessionHeader("2026-09-12T12:16:40.006Z", "s1", "/p"),
		piAssistant("2026-09-12T12:17:00.000Z", "m1", "m", 0, 0, 0, 0, 0, 0),
	}, "\n") + "\n"

	got := total(read(t, ToolPi, body))
	if got.Requests != 0 || got.Total() != 0 {
		t.Errorf("a zero-usage message was counted: %+v", got)
	}
}

// UTC stamps land on the local day, the same rule the other readers follow:
// the boundary that matters is the one the person lived through.
func TestPiDaysAreLocalDays(t *testing.T) {
	body := strings.Join([]string{
		piSessionHeader("2026-09-12T00:00:00.000Z", "s1", "/p"),
		// 23:30 UTC on the 12th is 07:30 on the 13th at UTC+8.
		piAssistant("2026-09-12T23:30:00.000Z", "m1", "m", 1, 1, 0, 0, 0, 2),
	}, "\n") + "\n"

	dir := t.TempDir()
	path := filepath.Join(dir, "t.jsonl")
	writeFile(t, path, body)
	east := time.FixedZone("UTC+8", 8*3600)
	f := (&Scanner{Loc: east}).ReadFile(ToolPi, path)
	if len(f.Buckets) != 1 || f.Buckets[0].Day != "2026-09-13" {
		t.Errorf("buckets=%+v, want one on 2026-09-13; the UTC stamp was used", f.Buckets)
	}
}

// A record that cannot be dated is skipped and counted, never filed under
// today: a timestamp the parser cannot read and a session that ran today must
// not look alike.
func TestPiAnUndatableRecordIsSkippedAndCounted(t *testing.T) {
	body := strings.Join([]string{
		piSessionHeader("2026-09-12T00:00:00.000Z", "s1", "/p"),
		piAssistant("not-a-time", "m1", "m", 1, 1, 0, 0, 0, 2),
		piAssistant("2026-09-12T01:00:00.000Z", "m2", "m", 1, 1, 0, 0, 0, 2),
	}, "\n") + "\n"

	f := read(t, ToolPi, body)
	if f.Skipped != 1 {
		t.Errorf("Skipped=%d, want 1", f.Skipped)
	}
	if got := total(f); got.Requests != 1 {
		t.Errorf("Requests=%d, want 1; the undatable record was counted anyway", got.Requests)
	}
}

// TestTheNewAgentRoots pins the two default locations and the walk shapes,
// because a root that is never reached reads exactly like an agent that has
// spent nothing.
func TestTheNewAgentRoots(t *testing.T) {
	home := t.TempDir()
	s := DefaultScanner(home)
	if got, want := s.Roots()[ToolHermes], filepath.Join(home, ".hermes"); got != want {
		t.Errorf("hermes root %q, want %q", got, want)
	}
	if got, want := s.Roots()[ToolPi], filepath.Join(home, ".pi", "agent", "sessions"); got != want {
		t.Errorf("pi root %q, want %q", got, want)
	}

	// Hermes: absent, then present with no ledger, then with one.
	refs, src, err := s.Walk(ToolHermes)
	if err != nil {
		t.Fatal(err)
	}
	if src.Found || src.Problem != "not found" || len(refs) != 0 {
		t.Fatalf("hermes absent: found=%v problem=%q refs=%d", src.Found, src.Problem, len(refs))
	}
	hermesRoot := s.Roots()[ToolHermes]
	if err := os.MkdirAll(hermesRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	refs, src, err = s.Walk(ToolHermes)
	if err != nil {
		t.Fatal(err)
	}
	if src.Problem != "no "+hermesDBFile || len(refs) != 0 {
		t.Fatalf("hermes without a ledger: problem=%q refs=%d", src.Problem, len(refs))
	}
	writeFile(t, filepath.Join(hermesRoot, hermesDBFile), "")
	refs, src, err = s.Walk(ToolHermes)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || !src.Found || src.Files != 1 {
		t.Fatalf("hermes with a ledger: refs=%v source=%+v", refs, src)
	}

	// pi: a tree of JSONL files. Only `.jsonl` is a transcript.
	piRoot := s.Roots()[ToolPi]
	if err := os.MkdirAll(filepath.Join(piRoot, "--home-agent--"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(piRoot, "--home-agent--", "2026-09-12T12-16-40-006Z_u.jsonl"), "{}\n")
	writeFile(t, filepath.Join(piRoot, "--home-agent--", "notes.txt"), "not a transcript\n")
	refs, src, err = s.Walk(ToolPi)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || !src.Found || src.Files != 1 {
		t.Fatalf("pi walk: refs=%v source=%+v", refs, src)
	}
}
