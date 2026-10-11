package home

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRolloverPathsAndLongSessionTodos(t *testing.T) {
	dir, base := fixture(t)
	var index Index
	now := time.Now()
	path, project, err := index.RolloverHandoff(dir, dir, "session-1", now)
	if err != nil || project != "demo" || path != filepath.Join(base, "agent-docs", "handoffs", now.Format("2006-01-02-15-04")+"-session-1.md") {
		t.Fatal(path, project, err)
	}
	if _, err = os.Stat(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	}
	if path, project, err = index.RolloverHandoff(dir, filepath.Join(dir, "different"), "session-1", now); err != nil || path != "" || project != "" {
		t.Fatal(path, project, err)
	}
	if _, _, err = index.RolloverHandoff(dir, dir, "../escape", now); err == nil {
		t.Fatal("unsafe id")
	}
	hours := 1.5
	meta, rev, err := index.PatchMeta(dir, "demo", PatchMeta{RolloverAfterHours: &hours})
	if err != nil || meta.RolloverAfterHours != hours {
		t.Fatal(meta, err)
	}
	runtime := []RuntimeProject{{ID: "panel", Path: dir, Sessions: []Session{
		{ID: "old", Name: "old agent", Agent: "codex", State: "done", CreatedAt: now.Add(-2 * time.Hour).Unix()},
		{ID: "working", Agent: "claude", State: "working", CreatedAt: now.Add(-3 * time.Hour).Unix()},
		{ID: "new", Agent: "codex", State: "done", CreatedAt: now.Unix()},
		{ID: "shell", State: "done", CreatedAt: now.Add(-3 * time.Hour).Unix()},
	}}}
	snapshot := index.Snapshot(dir, false, runtime)
	if len(snapshot.Todos) != 1 || snapshot.Todos[0].Kind != "session_rollover" || snapshot.Todos[0].Link.SessionID != "old" {
		t.Fatal(snapshot.Todos)
	}
	zero := 0.0
	if _, _, err = index.PatchMeta(dir, "demo", PatchMeta{Rev: rev, RolloverAfterHours: &zero}); err != nil {
		t.Fatal(err)
	}
	if got := index.Snapshot(dir, false, runtime); len(got.Todos) != 0 {
		t.Fatal(got.Todos)
	}
	neg := -1.0
	if _, _, err = index.PatchMeta(dir, "demo", PatchMeta{RolloverAfterHours: &neg}); err == nil {
		t.Fatal("negative hours accepted")
	}
}

func TestRolloverHandoffCannotEscapeHarness(t *testing.T) {
	dir, base := fixture(t)
	outside := filepath.Join(dir, "outside")
	if err := os.MkdirAll(filepath.Join(base, "agent-docs"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(outside, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(base, "agent-docs", "handoffs")); err != nil {
		t.Fatal(err)
	}
	var index Index
	if _, _, err := index.RolloverHandoff(dir, dir, "s", time.Now()); err == nil || !strings.Contains(err.Error(), "escapes") {
		t.Fatal(err)
	}
}
