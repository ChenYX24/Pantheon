package usage

import (
	"database/sql"
	"fmt"
	"time"
)

// ─── Hermes ───────────────────────────────────────────────────────────────

// hermesDBFile is the ledger inside the root the scanner probes.
const hermesDBFile = "state.db"

/*
readHermes aggregates Hermes' SQLite ledger.

The table read is `session_model_usage`, one row per (session, model,
provider, task). That is the right source rather than the `sessions` summary
columns, and the difference is what gets counted. `sessions.input_tokens` and
friends carry the *main loop* only; the per-model table also carries the
auxiliary calls — title generation, approval checks, compression — which are
API calls with real token counts. Hermes' own overview makes the same choice
in as many words: "session counters carry main-loop usage only — sum the
breakdown when available so overview totals match the per-model table and aux
spend isn't undercounted" (agent/insights.py, _compute_overview). Summing the
breakdown here reproduces the figure Hermes itself would show.

Reasoning is not added to Output. Hermes' own totals sum exactly
input+output+cache_read+cache_write and list reasoning beside them
(_TOKEN_KEYS in insights.py), which is also the only consistent reading of the
data: its reasoning counter is a detail of output, as OpenAI-style thinking
tokens are, and folding it in would double-count. opencode's column is the
disjoint one and only readOpencode folds; the two must not be made to agree.

Day attribution is coarser than the other readers and no finer answer exists.
A row is cumulative for a session/model/task, so a session that spans midnight
has its whole row placed on the day of `last_seen` — the most recent call in
that row, which is also the timestamp Hermes' own insights scope rows by. The
alternative, splitting a row across midnight, needs a per-call distribution
that Hermes does not store, and inventing one is the thing this package exists
not to do.

Opened like the opencode database, and for the same reasons: read-only with
`query_only`, no `immutable` so the WAL (where a running Hermes' latest work
is) is read, a short busy timeout because being late is free. Only
`session_model_usage` and `sessions` are named; this file also holds
conversation content, credentials and gateway state, and none of it is this
package's business.
*/
func readHermes(path string, loc *time.Location) (readResult, error) {
	var out readResult

	dsn := "file:" + path + "?mode=ro&_pragma=query_only(1)&_pragma=busy_timeout(2000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return out, err
	}
	defer db.Close() //nolint:errcheck // read-only

	rows, err := db.Query(`
		SELECT u.session_id,
		       u.model,
		       u.api_call_count,
		       u.input_tokens,
		       u.output_tokens,
		       u.cache_read_tokens,
		       u.cache_write_tokens,
		       COALESCE(NULLIF(u.last_seen, 0), NULLIF(s.last_activity_at, 0), s.started_at),
		       s.cwd
		FROM session_model_usage u
		LEFT JOIN sessions s ON s.id = u.session_id`)
	if err != nil {
		// A schema this does not recognise is a Problem on the source, not a
		// failed pass: Hermes may be older than the table, and every other
		// agent's numbers must still arrive.
		return out, fmt.Errorf("reading %s: %w", hermesDBFile, err)
	}
	defer rows.Close() //nolint:errcheck // read-only

	agg := map[key]*Bucket{}
	for rows.Next() {
		var session, model, cwd sql.NullString
		var calls, in, output, cacheRead, cacheWrite sql.NullInt64
		var at sql.NullFloat64
		if err := rows.Scan(&session, &model, &calls, &in, &output,
			&cacheRead, &cacheWrite, &at, &cwd); err != nil {
			return out, err
		}
		// Unix seconds as REAL, so the sub-second part survives the scan. A
		// row with no timestamp at all cannot be put on a day; it is skipped
		// and counted rather than guessed onto today.
		if !at.Valid || at.Float64 <= 0 {
			out.skipped++
			continue
		}
		sec := int64(at.Float64)
		nsec := int64((at.Float64 - float64(sec)) * 1e9)
		day := time.Unix(sec, nsec).In(loc).Format(dayFormat)

		c := Counts{
			Input:      in.Int64,
			Output:     output.Int64,
			CacheRead:  cacheRead.Int64,
			CacheWrite: cacheWrite.Int64,
		}
		if c.Total() == 0 {
			// A row that recorded no tokens records no call either.
			continue
		}
		// The count Hermes itself wrote, not one per row: an aux row can say
		// it aggregated thirteen calls, and "13" is the honest answer.
		c.Requests = calls.Int64
		add(agg, key{day, session.String, model.String}, cwd.String, c)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	out.buckets = flatten(agg)
	return out, nil
}
