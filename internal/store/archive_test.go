package store

import (
	"context"
	"errors"
	"testing"
)

// Archiving hides a project and restoring brings back the same row: the id,
// the note and the sessions are what make it "the same project", so a restore
// that produced a lookalike would pass a test that only compared names.
func TestAnArchivedProjectLeavesTheSidebarAndComesBackWhole(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	a, _ := db.CreateProject(ctx, "pa", "alpha", "/src/alpha")
	if _, err := db.CreateProject(ctx, "pb", "bravo", "/src/bravo"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SetNote(ctx, a.ID, "remember this"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateSession(ctx, Session{ID: "s1", ProjectID: a.ID, TmuxName: "vp_s1"}); err != nil {
		t.Fatal(err)
	}
	idx := 0
	if err := db.SetProjectSortIndex(ctx, a.ID, &idx); err != nil {
		t.Fatal(err)
	}

	if err := db.ArchiveProject(ctx, a.ID, false); err != nil {
		t.Fatalf("ArchiveProject: %v", err)
	}
	if got := projectIDs(t, db.ListProjects); len(got) != 1 || got[0] != "pb" {
		t.Fatalf("sidebar after archiving alpha = %v, want [pb]", got)
	}
	arch, err := db.ListArchivedProjects(ctx)
	if err != nil || len(arch) != 1 || arch[0].ID != a.ID || arch[0].ArchivedAt == nil || arch[0].ArchivedAuto {
		t.Fatalf("archived list = %+v, %v; want alpha, archived by hand", arch, err)
	}
	// Hidden, not ended: the session row is what the process is reached by.
	if ss, _ := db.ListProjectSessions(ctx, a.ID); len(ss) != 1 {
		t.Fatalf("archiving took the project's sessions with it: %d rows", len(ss))
	}

	// Backdate it, so "restoring counts as activity" is something the test
	// can see rather than something that happens to be true within a second.
	if _, err := db.sql.Exec(`UPDATE projects SET last_active_at = 1 WHERE id = ?`, a.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.RestoreProject(ctx, a.ID); err != nil {
		t.Fatalf("RestoreProject: %v", err)
	}
	p, err := db.GetProject(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if p.ArchivedAt != nil || p.ArchivedAuto {
		t.Errorf("restored project still reads as archived: %+v", p)
	}
	if p.LastActiveAt <= 1 {
		t.Error("restoring did not count as activity; the idle rule would take it straight back")
	}
	if p.SortIndex != nil {
		t.Errorf("restored project kept manual position %d, which may now be another project's", *p.SortIndex)
	}
	if n, _ := db.GetNote(ctx, a.ID); n.Content != "remember this" {
		t.Errorf("note after restore = %q", n.Content)
	}
	if got := projectIDs(t, db.ListProjects); len(got) != 2 {
		t.Errorf("sidebar after restore = %v, want both", got)
	}
}

// The archived list says who archived a project, and a second archive must
// not rewrite that: the idle rule running over a project somebody archived by
// hand would otherwise relabel it as the panel's doing.
func TestArchivingAgainDoesNotChangeWhoDidIt(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	p, _ := db.CreateProject(ctx, "pa", "alpha", "/src/alpha")
	if err := db.ArchiveProject(ctx, p.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := db.ArchiveProject(ctx, p.ID, true); !errors.Is(err, ErrAlreadyArchived) {
		t.Fatalf("second archive = %v, want ErrAlreadyArchived", err)
	}
	got, _ := db.GetProject(ctx, p.ID)
	if got.ArchivedAuto {
		t.Error("a manual archive was relabelled automatic")
	}
	if err := db.ArchiveProject(ctx, "nope", false); !errors.Is(err, ErrNotFound) {
		t.Errorf("archiving a missing project = %v, want ErrNotFound", err)
	}
}

func TestRestoringIsIdempotentButNotForMissingProjects(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	p, _ := db.CreateProject(ctx, "pa", "alpha", "/src/alpha")
	if err := db.RestoreProject(ctx, p.ID); err != nil {
		t.Errorf("restoring a project in the sidebar = %v, want nil", err)
	}
	if err := db.RestoreProject(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("restoring a missing project = %v, want ErrNotFound", err)
	}
}

func TestArchivedProjectAtFindsOnlyArchivedOnes(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	p, _ := db.CreateProject(ctx, "pa", "alpha", "/src/alpha")
	if _, err := db.ArchivedProjectAt(ctx, "/src/alpha"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a project in the sidebar was offered for restore: %v", err)
	}
	if err := db.ArchiveProject(ctx, p.ID, true); err != nil {
		t.Fatal(err)
	}
	got, err := db.ArchivedProjectAt(ctx, "/src/alpha")
	if err != nil || got.ID != p.ID {
		t.Fatalf("ArchivedProjectAt = %+v, %v", got, err)
	}
	if _, err := db.ArchivedProjectAt(ctx, "/src/alph"); !errors.Is(err, ErrNotFound) {
		t.Errorf("a path prefix matched: %v", err)
	}
}

// Every way a project can have been touched since the cutoff keeps it out of
// the idle list. Each case removes exactly one: a clause missing from the
// query shows up as that one case archiving a project somebody is using.
func TestIdleProjectsLeavesAloneAnythingTouchedSinceTheCutoff(t *testing.T) {
	const cutoff = 1000
	old := func(t *testing.T, db *DB, id string) {
		t.Helper()
		if _, err := db.CreateProject(context.Background(), id, id, "/src/"+id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.sql.Exec(`UPDATE projects SET last_active_at = 10, created_at = 10 WHERE id = ?`, id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.sql.Exec(`UPDATE notes SET updated_at = 10 WHERE project_id = ?`, id); err != nil {
			t.Fatal(err)
		}
	}
	withSession := func(t *testing.T, db *DB, id, set string) {
		t.Helper()
		if _, err := db.CreateSession(context.Background(), Session{ID: "s_" + id, ProjectID: id, TmuxName: "vp_" + id}); err != nil {
			t.Fatal(err)
		}
		if _, err := db.sql.Exec(`UPDATE sessions SET created_at = 10, state_changed_at = 10, last_output_at = 10 WHERE id = ?`, "s_"+id); err != nil {
			t.Fatal(err)
		}
		if set != "" {
			if _, err := db.sql.Exec(`UPDATE sessions SET `+set+` = 2000 WHERE id = ?`, "s_"+id); err != nil {
				t.Fatal(err)
			}
		}
	}
	cases := []struct {
		name string
		idle bool
		make func(t *testing.T, db *DB)
	}{
		{"untouched", true, func(t *testing.T, db *DB) { old(t, db, "p") }},
		{"untouched, with an old session", true, func(t *testing.T, db *DB) { old(t, db, "p"); withSession(t, db, "p", "") }},
		{"pinned", false, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if err := db.SetProjectPinned(context.Background(), "p", true); err != nil {
				t.Fatal(err)
			}
		}},
		{"session created since", false, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if _, err := db.sql.Exec(`UPDATE projects SET last_active_at = 2000 WHERE id = 'p'`); err != nil {
				t.Fatal(err)
			}
		}},
		{"project created since", false, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if _, err := db.sql.Exec(`UPDATE projects SET created_at = 2000 WHERE id = 'p'`); err != nil {
				t.Fatal(err)
			}
		}},
		{"a session printed since", false, func(t *testing.T, db *DB) { old(t, db, "p"); withSession(t, db, "p", "last_output_at") }},
		{"a session changed state since", false, func(t *testing.T, db *DB) { old(t, db, "p"); withSession(t, db, "p", "state_changed_at") }},
		{"a session row created since", false, func(t *testing.T, db *DB) { old(t, db, "p"); withSession(t, db, "p", "created_at") }},
		{"note edited since", false, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if _, err := db.sql.Exec(`UPDATE notes SET updated_at = 2000 WHERE project_id = 'p'`); err != nil {
				t.Fatal(err)
			}
		}},
		{"a todo added since", false, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if _, err := db.CreateTodo(context.Background(), "t1", "p", "ship it"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.sql.Exec(`UPDATE todos SET created_at = 2000 WHERE id = 't1'`); err != nil {
				t.Fatal(err)
			}
		}},
		{"a todo ticked since", false, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if _, err := db.CreateTodo(context.Background(), "t1", "p", "ship it"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.sql.Exec(`UPDATE todos SET created_at = 10, done = 1, done_at = 2000 WHERE id = 't1'`); err != nil {
				t.Fatal(err)
			}
		}},
		{"an old todo", true, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if _, err := db.CreateTodo(context.Background(), "t1", "p", "ship it"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.sql.Exec(`UPDATE todos SET created_at = 10 WHERE id = 't1'`); err != nil {
				t.Fatal(err)
			}
		}},
		{"already archived", false, func(t *testing.T, db *DB) {
			old(t, db, "p")
			if err := db.ArchiveProject(context.Background(), "p", false); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			db := openTest(t)
			c.make(t, db)
			got, err := db.IdleProjects(context.Background(), cutoff)
			if err != nil {
				t.Fatal(err)
			}
			if idle := len(got) == 1; idle != c.idle {
				t.Errorf("idle = %v, want %v (%+v)", idle, c.idle, got)
			}
			// The write asks the same question again, and must get the same
			// answer: the two are one predicate, and this is what says so.
			archived, err := db.ArchiveIfIdle(context.Background(), "p", cutoff)
			if err != nil {
				t.Fatal(err)
			}
			if archived != c.idle {
				t.Errorf("ArchiveIfIdle = %v, want %v", archived, c.idle)
			}
			if archived {
				p, _ := db.GetProject(context.Background(), "p")
				if p.ArchivedAt == nil || !p.ArchivedAuto {
					t.Errorf("archived by the idle rule but reads %+v", p)
				}
			}
		})
	}
}

func projectIDs(t *testing.T, list func(context.Context) ([]Project, error)) []string {
	t.Helper()
	ps, err := list(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, p := range ps {
		out = append(out, p.ID)
	}
	return out
}

// The idle list is a list of candidates. A project that printed after it was
// listed and before its turn to be archived stays where it is.
func TestTheIdleRuleLooksAgainBeforeArchiving(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	if _, err := db.CreateProject(ctx, "p", "p", "/src/p"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.sql.Exec(`UPDATE projects SET last_active_at = 10, created_at = 10 WHERE id = 'p'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.sql.Exec(`UPDATE notes SET updated_at = 10 WHERE project_id = 'p'`); err != nil {
		t.Fatal(err)
	}
	if got, _ := db.IdleProjects(ctx, 1000); len(got) != 1 {
		t.Fatalf("setup: want p idle, got %+v", got)
	}
	if _, err := db.SetNote(ctx, "p", "back at it"); err != nil {
		t.Fatal(err)
	}
	archived, err := db.ArchiveIfIdle(ctx, "p", 1000)
	if err != nil {
		t.Fatal(err)
	}
	if archived {
		t.Error("a project touched after it was listed as idle was archived anyway")
	}
}
