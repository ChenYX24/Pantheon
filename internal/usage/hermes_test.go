package usage

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// A cut-down Hermes ledger: the two tables the reader is allowed to touch.
//
// The real state.db also holds conversation content, gateway routing and
// credentials. This fixture does not define those tables, so a query that
// grows a join to them fails here rather than loading somebody's messages.
func hermesDB(t *testing.T, dir string, sessions []hermesSession, rows []hermesRow) string {
	t.Helper()
	path := filepath.Join(dir, hermesDBFile)
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close() //nolint:errcheck // test fixture
	for _, ddl := range []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY, cwd TEXT,
			started_at REAL NOT NULL, ended_at REAL, last_activity_at REAL)`,
		`CREATE TABLE session_model_usage (
			session_id TEXT NOT NULL, model TEXT NOT NULL, task TEXT NOT NULL DEFAULT '',
			api_call_count INTEGER NOT NULL DEFAULT 0,
			input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
			cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0,
			reasoning_tokens INTEGER NOT NULL DEFAULT 0,
			first_seen REAL NOT NULL DEFAULT 0, last_seen REAL NOT NULL DEFAULT 0)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	for _, s := range sessions {
		if _, err := db.Exec(`INSERT INTO sessions (id, cwd, started_at, ended_at, last_activity_at)
			VALUES (?, ?, ?, ?, ?)`, s.ID, s.CWD, s.Started, s.Ended, s.LastActivity); err != nil {
			t.Fatal(err)
		}
	}
	for i, r := range rows {
		if _, err := db.Exec(`INSERT INTO session_model_usage
			(session_id, model, task, api_call_count, input_tokens, output_tokens,
			 cache_read_tokens, cache_write_tokens, reasoning_tokens, first_seen, last_seen)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			r.Session, r.Model, r.Task, r.Calls, r.In, r.Out, r.CacheR, r.CacheW,
			r.Reasoning, r.LastSeen, r.LastSeen); err != nil {
			t.Fatalf("row %d: %v", i, err)
		}
	}
	return path
}

type hermesSession struct {
	ID           string
	CWD          string
	Started      float64
	Ended        float64
	LastActivity float64
}

type hermesRow struct {
	Session, Model, Task               string
	Calls                              int64
	In, Out, CacheR, CacheW, Reasoning int64
	// LastSeen is Unix seconds; zero exercises the fallback to the session's
	// own last_activity_at.
	LastSeen float64
}

// TestHermesSumsItsPerModelLedger pins the source and the columns.
//
// The reading that had to be got right is *which table*. Hermes' sessions row
// holds main-loop totals only; auxiliary calls (titles, approvals,
// compression) live in session_model_usage and are real spend. Hermes' own
// overview sums the breakdown for exactly this reason. Reading the sessions
// row instead would report the figures below minus the aux row, with nothing
// failing anywhere.
func TestHermesSumsItsPerModelLedger(t *testing.T) {
	loc := time.FixedZone("UTC+8", 8*3600)
	// 2026-03-04 07:30 UTC is 15:30 on the 4th at UTC+8; 17:00 UTC is 01:00 on
	// the 5th. Two instants, two local days, only one of them a UTC day.
	day4 := float64(time.Date(2026, 3, 4, 7, 30, 0, 0, time.UTC).Unix())
	day5 := float64(time.Date(2026, 3, 4, 17, 0, 0, 0, time.UTC).Unix())
	// The fallback target for a row with no last_seen: the session's own last
	// activity, which here is the later of the two local days.
	lastActivity := day5

	dir := t.TempDir()
	path := hermesDB(t, dir,
		[]hermesSession{{ID: "s1", CWD: "/home/agent", Started: day4, LastActivity: lastActivity}},
		[]hermesRow{
			{Session: "s1", Model: "gpt-x", Calls: 3, In: 109, Out: 275, CacheR: 8192,
				Reasoning: 115, LastSeen: day4},
			// An auxiliary call: title generation. It does not touch the
			// sessions summary row and it is a real API call.
			{Session: "s1", Model: "gpt-x", Task: "title_generation", Calls: 1,
				In: 10, Out: 20, CacheW: 5, LastSeen: day4},
			// A different model, and the instant that crosses midnight.
			{Session: "s1", Model: "small", Calls: 1, In: 1, Out: 2, LastSeen: day5},
			// No timestamp on the row: falls back to the session's own
			// last_activity_at, which is the day it last worked.
			{Session: "s1", Model: "small", Task: "approval", Calls: 1,
				In: 4, Out: 6, LastSeen: 0},
			// A row that recorded nothing is not a request.
			{Session: "s1", Model: "small"},
		},
	)

	s := &Scanner{Loc: loc}
	res, err := readHermes(path, s.loc())
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	byDay := map[string]*Bucket{}
	for _, b := range res.buckets {
		d := byDay[b.Day]
		if d == nil {
			d = &Bucket{Day: b.Day, Model: b.Model, CWD: b.CWD}
			byDay[b.Day] = d
		}
		d.Counts.Add(b.Counts)
	}
	if len(byDay) != 2 {
		t.Fatalf("days=%v, want two local days", byDay)
	}

	got := byDay["2026-03-04"]
	if got == nil {
		t.Fatalf("no bucket for 2026-03-04; got %v", byDay)
	}
	if got.Input != 109+10 {
		t.Errorf("Input=%d, want 119 -- the auxiliary row was dropped or counted twice", got.Input)
	}
	// Reasoning stays out of Output. Hermes' own totals sum only
	// input+output+cache_read+cache_write, because its reasoning counter is a
	// detail of output.
	if got.Output != 275+20 {
		t.Errorf("Output=%d, want 295 (reasoning is not added again)", got.Output)
	}
	if got.CacheRead != 8192 || got.CacheWrite != 5 {
		t.Errorf("cache read=%d write=%d, want 8192/5", got.CacheRead, got.CacheWrite)
	}
	if got.Requests != 3+1 {
		t.Errorf("Requests=%d, want 4 (the counts Hermes recorded, not one per row)", got.Requests)
	}
	if got.CWD != "/home/agent" {
		t.Errorf("CWD=%q, want the session's directory", got.CWD)
	}

	// The invariant the other readers are held to: what the panel reports is
	// what the agent wrote down, computed from Hermes' own four token keys.
	const storedDay4 = (109 + 275 + 8192) + (10 + 20 + 5)
	if got.Total() != storedDay4 {
		t.Errorf("Total()=%d, want %d", got.Total(), storedDay4)
	}

	// The row with no last_seen landed on the session's last activity day,
	// and the midnight-crossing row on the next local day.
	next := byDay["2026-03-05"]
	if next == nil {
		t.Fatalf("no bucket for 2026-03-05; the zone or the fallback did not apply: %v", byDay)
	}
	if next.Input != 1+4 || next.Output != 2+6 || next.Requests != 2 {
		t.Errorf("2026-03-05 = %+v, want the midnight row plus the fallback row", next.Counts)
	}
	// Two models, two buckets on the first day: a session that switched
	// models must not be attributed to whichever model it started with.
	models := map[string]bool{}
	for _, b := range res.buckets {
		models[b.Model] = true
	}
	if !models["gpt-x"] || !models["small"] {
		t.Errorf("models=%v, want gpt-x and small kept apart", models)
	}
}

// TestHermesWalkFindsOneDatabase pins the shape of the walk the same way the
// opencode one does: a root with no ledger is not a zero, and the ledger is
// one path with a cursor.
func TestHermesWalkFindsOneDatabase(t *testing.T) {
	home := t.TempDir()
	s := DefaultScanner(home)
	root := s.Roots()[ToolHermes]

	refs, src, err := s.Walk(ToolHermes)
	if err != nil {
		t.Fatal(err)
	}
	if src.Found || src.Problem != "not found" || len(refs) != 0 {
		t.Fatalf("absent: found=%v problem=%q refs=%d", src.Found, src.Problem, len(refs))
	}

	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	refs, src, err = s.Walk(ToolHermes)
	if err != nil {
		t.Fatal(err)
	}
	if src.Problem != "no "+hermesDBFile || len(refs) != 0 {
		t.Fatalf("no ledger: problem=%q refs=%d", src.Problem, len(refs))
	}

	path := hermesDB(t, root, nil, nil)
	refs, src, err = s.Walk(ToolHermes)
	if err != nil {
		t.Fatal(err)
	}
	// The walk reports the resolved root, and t.TempDir is a symlink on macOS
	// (/var -> /private/var), so an unresolved comparison fails there and
	// passes on Linux. Resolve the expectation, not the assertion.
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].Path != resolved {
		t.Fatalf("refs=%v, want exactly the database at %s", refs, resolved)
	}
	if refs[0].Size <= 0 || refs[0].ModifiedAt <= 0 {
		t.Fatalf("ref carries no cursor: %+v", refs[0])
	}
	if !src.Found || src.Files != 1 || !src.Complete {
		t.Fatalf("source: found=%v files=%d complete=%v", src.Found, src.Files, src.Complete)
	}
}

// An older Hermes without the per-model table must be a Problem on the file,
// not a failed pass and not a zero: the other agents' numbers still arrive,
// and the UI can say this one could not be read.
func TestHermesWithoutTheLedgerTableIsAProblemNotZero(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, hermesDBFile)
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	f := (&Scanner{Loc: time.UTC}).ReadFile(ToolHermes, path)
	if f.Problem == "" {
		t.Error("a database without session_model_usage produced no Problem; it would render as zero")
	}
	if len(f.Buckets) != 0 {
		t.Errorf("buckets=%d, want none", len(f.Buckets))
	}
}
