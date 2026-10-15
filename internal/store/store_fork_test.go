package store

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func seedForkSchema(t *testing.T, path string, steps []migration, version int) *sql.DB {
	t.Helper()
	raw, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	tx, err := raw.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, step := range steps {
		if err := step.up(tx); err != nil {
			t.Fatalf("seed %s: %v", step.name, err)
		}
	}
	if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", version)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestPantheon37UpgradesWithoutLosingRows(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "pantheon.db")
	// v1.25.0-pantheon.3 ran these 37 steps. The fixed boundary matters:
	// seeding the latest schema would never exercise the deployed upgrade.
	raw := seedForkSchema(t, path, migrations[:37], 37)
	const board = `{"goal":"Keep the board","stages":[],"tasks":[]}`
	for _, stmt := range []string{
		`INSERT INTO projects (id, name, path, last_active_at, created_at) VALUES ('p1', 'Keep', '/project', 1, 1)`,
		`INSERT INTO sessions (id, project_id, tmux_name, created_at, archive_note) VALUES ('s1', 'p1', 'vp_keep', 1, 'Keep the handoff')`,
	} {
		if _, err := raw.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := raw.Exec(`INSERT INTO project_boards (project_id, content, rev) VALUES ('p1', ?, 7)`, board); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if v, err := db.Version(ctx); err != nil || v != 42 {
		t.Fatalf("version = %d, %v; want 42", v, err)
	}
	s, err := db.GetSession(ctx, "s1")
	if err != nil {
		t.Fatal(err)
	}
	if s.ProjectID != "p1" || s.TmuxName != "vp_keep" || s.ArchiveNote != "Keep the handoff" ||
		s.Summary != "" || s.Progress != -1 || s.Labels == nil || len(s.Labels) != 0 {
		t.Fatalf("session after upgrade: %+v", s)
	}
	var summary, labels, content string
	var progress int
	var rev int64
	if err := db.sql.QueryRow(`SELECT summary, progress, labels FROM sessions WHERE id = 's1'`).Scan(&summary, &progress, &labels); err != nil {
		t.Fatal(err)
	}
	if summary != "" || progress != -1 || labels != "" {
		t.Fatalf("self-description defaults = %q, %d, %q", summary, progress, labels)
	}
	if err := db.sql.QueryRow(`SELECT content, rev FROM project_boards WHERE project_id = 'p1'`).Scan(&content, &rev); err != nil {
		t.Fatal(err)
	}
	if content != board || rev != 7 {
		t.Fatalf("board after upgrade = %q rev %d", content, rev)
	}
	created, err := db.CreateSession(ctx, Session{ID: "s2", ProjectID: "p1", TmuxName: "vp_new", ArchiveNote: "New note"})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := db.GetSession(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []Session{created, stored} {
		if row.ArchiveNote != "New note" || row.Summary != "" || row.Progress != -1 || row.Labels == nil || len(row.Labels) != 0 {
			t.Fatalf("new session defaults: %+v", row)
		}
	}
}

func TestUpstreamNumberedDatabasesAreRefused(t *testing.T) {
	for version := 31; version <= 37; version++ {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "upstream.db")
			// Upstream's 031–035 are our 038–042, with identical bodies.
			// Also cover 36 and 37 so future upstream steps cannot slip past.
			steps := append([]migration(nil), migrations[:30]...)
			steps = append(steps, migrations[37:37+min(version-30, 5)]...)
			raw := seedForkSchema(t, path, steps, version)
			const schema = `SELECT group_concat(sql, ';') FROM (SELECT sql FROM sqlite_master ORDER BY name)`
			var before string
			if err := raw.QueryRow(schema).Scan(&before); err != nil {
				t.Fatal(err)
			}
			raw.Close()
			db, err := Open(context.Background(), path)
			if db != nil {
				db.Close()
				t.Fatal("opened an upstream-numbered database")
			}
			if err == nil || !strings.Contains(err.Error(), "project_boards") || !strings.Contains(err.Error(), "different migration numbers") {
				t.Fatalf("refusal = %v", err)
			}
			raw, err = sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			var after string
			var v int
			if err := raw.QueryRow(schema).Scan(&after); err != nil {
				t.Fatal(err)
			}
			if err := raw.QueryRow("PRAGMA user_version").Scan(&v); err != nil {
				t.Fatal(err)
			}
			if after != before || v != version {
				t.Fatalf("refused database was migrated: version %d -> %d, schema unchanged = %v", version, v, after == before)
			}
		})
	}
}
