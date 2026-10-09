package home

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	harness := filepath.Join(dir, "harness")
	put(t, filepath.Join(harness, "projects/demo/project.json"), `{"id":"demo","aliases":["Demo"],"status":"active","state_mode":"linked","sync":"github"}`)
	local, _ := json.Marshal(map[string]any{"version": 1, "paths": map[string]string{"cyx-agent-harness": harness, "demo": dir}})
	put(t, filepath.Join(dir, "local.json"), string(local))
	return dir, filepath.Join(harness, "projects/demo")
}

func put(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestHomeActiveContextVariants(t *testing.T) {
	for _, keys := range [][4]string{{"gOaL", "Active plan", "Last verified commit", "Blockers"}, {"目标", "活动文档", "已验证基线", "阻塞"}, {"Goal", "活动文档", "最后验证", "阻塞"}} {
		for _, colon := range []string{":", "："} {
			data := fmt.Sprintf("- **%s**%s Ship [home](home.md)\n- **%s**%s [A](a.md) [B](b.md)\n- **%s**%s abc123\n- **%s**%s approval\n  - **Goal**: nested ignored\n", keys[0], colon, keys[1], colon, keys[2], colon, keys[3], colon)
			got := ParseActiveContext([]byte(data))
			if got.Goal != "Ship home" || got.LastVerified != "abc123" || len(got.ActiveDocs) != 2 || got.ActiveDocs[1].Href != "b.md" || !reflect.DeepEqual(got.Blockers, []string{"approval"}) {
				t.Fatalf("%+v", got)
			}
		}
	}
	if got := ParseActiveContext([]byte("- **Goal**: " + strings.Repeat("中", 700))); len([]rune(got.Goal)) != 600 {
		t.Fatal("goal cap")
	}
}

func TestHomeFrontmatterAndWarnings(t *testing.T) {
	dir, project := fixture(t)
	put(t, filepath.Join(project, "agent-docs/tasks/A2/task.md"), "---\nid: A2\ntitle: \"A # title\"\nstatus: mystery\ndepends_on: [A1, B2]\nsession_status: other\n---\nbody\n")
	put(t, filepath.Join(project, "agent-docs/tasks/bad/task.md"), "---\nid: mismatch\n---\n")
	put(t, filepath.Join(project, "agent-docs/reports/question.md"), "---\ntitle: Help\nkind: question # comment\nneeds_user: true\nat: invalid\n---\n"+strings.Repeat("中", 6000))
	put(t, filepath.Join(project, "agent-docs/reports/bad.md"), "---\nnot a key\n")
	var index Index
	got := index.Snapshot(dir, false, nil)
	if !got.Available || len(got.Warnings) != 5 {
		t.Fatalf("%+v", got.Warnings)
	}
	detail := got.Details["demo"]
	if len(detail.Tasks) != 1 || detail.Tasks[0].Title != "A # title" || detail.Tasks[0].Status != "planned" || detail.Tasks[0].SessionStatus != "ok" || len(detail.Tasks[0].DependsOn) != 2 {
		t.Fatalf("%+v", detail.Tasks)
	}
	if len(detail.Reports) != 1 || len(detail.Reports[0].Body) > 16<<10 || len(got.Todos) != 1 || got.Todos[0].Kind != "question" {
		t.Fatalf("bad report/to-do: %+v", detail)
	}
}

func TestHomeSymlinkEscapesAndCaps(t *testing.T) {
	dir, project := fixture(t)
	outside := filepath.Join(dir, "outside")
	put(t, filepath.Join(outside, "task.md"), "---\nid: Escape\nstatus: blocked\n---\nprivate")
	if err := os.MkdirAll(filepath.Join(project, "agent-docs/tasks"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(project, "agent-docs/tasks/Escape")); err != nil {
		t.Fatal(err)
	}
	put(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), strings.Repeat("x", MaxFileSize+1))
	var index Index
	s := index.Snapshot(dir, false, nil)
	if len(s.Details["demo"].Tasks) != 0 || len(s.Warnings) != 2 {
		t.Fatalf("%+v", s)
	}
	status := "done"
	if _, err := index.Patch(dir, "demo", "Escape", PatchTask{Status: &status}); err == nil {
		t.Fatal("patched outside Harness")
	}
	if _, err := index.Create(dir, "demo", CreateTask{ID: "../escape", Title: "bad"}); err == nil {
		t.Fatal("path traversal")
	}
	if err := os.Remove(filepath.Join(project, "agent-docs/tasks/Escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(project, "agent-docs/tasks")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(project, "agent-docs/tasks")); err != nil {
		t.Fatal(err)
	}
	if _, err := index.Create(dir, "demo", CreateTask{ID: "X", Title: "bad"}); err == nil {
		t.Fatal("created outside Harness")
	}
	if _, err := os.Stat(filepath.Join(outside, "X")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("created external directory")
	}
}

func TestHomeTodoIDsOrderingAndCache(t *testing.T) {
	dir, project := fixture(t)
	put(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Blockers**: Need access\n")
	for n, status := range []string{"awaiting_review", "awaiting_approval", "blocked"} {
		id := fmt.Sprintf("T%d", n)
		put(t, filepath.Join(project, "agent-docs/tasks", id, "task.md"), fmt.Sprintf("---\nid: %s\ntitle: %s\nstatus: %s\nstage: A\nsession_status: rollover_due\nupdated: 2026-10-09T10:00:00Z\n---\n", id, id, status))
	}
	put(t, filepath.Join(project, "agent-docs/reports/q.md"), "---\ntitle: Q\nkind: question\nneeds_user: true\nat: 2026-10-09T09:00:00Z\n---\n")
	runtime := []RuntimeProject{{ID: "p1", Path: dir, Sessions: []Session{{ID: "s1", State: "waiting", StateChangedAt: "2026-10-09T12:00:00Z"}}}}
	var index Index
	a := index.Snapshot(dir, false, runtime)
	b := index.Snapshot(dir, false, runtime)
	if !reflect.DeepEqual(a.Todos, b.Todos) || len(a.Todos) != 9 {
		t.Fatalf("%+v", a.Todos)
	}
	if a.Todos[0].Kind != "question" || a.Todos[1].Kind != "awaiting_approval" || a.Todos[5].Kind != "session_waiting" || a.Todos[8].Kind != "session_rollover" {
		t.Fatalf("%+v", a.Todos)
	}
	want := Revision([]byte("session_waiting|demo|s1|2026-10-09T12:00:00Z"))
	if a.Todos[5].ID != want {
		t.Fatalf("got %s want %s", a.Todos[5].ID, want)
	}
	put(t, filepath.Join(project, "agent-docs/reports/q.md"), "---\ntitle: New question\nkind: question\nneeds_user: true\n---\n")
	c := index.Snapshot(dir, false, runtime)
	if c.Todos[0].ID == a.Todos[0].ID {
		t.Fatal("cached stale report")
	}
	var fresh Index
	if !reflect.DeepEqual(c.Projects, fresh.Snapshot(dir, false, runtime).Projects) {
		t.Fatal("restart changed projects")
	}
	link := filepath.Join(dir, "checkout-link")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	if !SamePath(dir, filepath.Join(link, ".")) || SamePath("", "") {
		t.Fatal("path matching")
	}
}

func TestHomeCreatePatchPreservesBytesAndConflicts(t *testing.T) {
	dir, project := fixture(t)
	var index Index
	task, err := index.Create(dir, "demo", CreateTask{ID: "A2", Title: "Quote # title", Body: "Acceptance\n", DependsOn: []string{"A1"}})
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "planned" || task.Title != "Quote # title" {
		t.Fatalf("%+v", task)
	}
	if _, err = index.Create(dir, "demo", CreateTask{ID: "A2", Title: "duplicate"}); !errors.Is(err, ErrExists) {
		t.Fatalf("duplicate: %v", err)
	}
	path := filepath.Join(project, task.File)
	original := "---\r\nid: A2\r\ntitle: Test\r\n# keep exactly\r\nunknown : [ x, y ] # spacing\r\nstatus: planned\r\nupdated: old\r\n---\r\nBody\r\n---\nraw bytes\t"
	put(t, path, original)
	put(t, filepath.Join(filepath.Dir(path), "handoff-001.md"), "handoff")
	status := "awaiting_review"
	updated, err := index.Patch(dir, "demo", "A2", PatchTask{Rev: Revision([]byte(original)), Status: &status})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Replace(original, "status: planned", "status: awaiting_review", 1)
	want = strings.Replace(want, "updated: old", "updated: "+updated.Updated, 1)
	if string(raw) != want || updated.Handoffs != 1 || updated.Rev != Revision(raw) {
		t.Fatalf("rewrite:\n%q\nwant:\n%q", raw, want)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0644 {
		t.Fatal("wrong mode")
	}
	_, err = index.Patch(dir, "demo", "A2", PatchTask{Rev: task.Rev, Status: &status})
	var stale *StaleError
	if !errors.As(err, &stale) || stale.Rev != updated.Rev {
		t.Fatalf("stale: %v", err)
	}
}

func TestHomeListingLimitsAndUnavailable(t *testing.T) {
	dir, project := fixture(t)
	var index Index
	if index.Snapshot(filepath.Join(dir, "missing"), false, nil).Available {
		t.Fatal("missing local.json")
	}
	for n := 0; n < 502; n++ {
		id := fmt.Sprintf("T%03d", n)
		put(t, filepath.Join(project, "agent-docs/tasks", id, "task.md"), fmt.Sprintf("---\nid: %s\nstatus: done\n---\n", id))
	}
	for n := 0; n < 52; n++ {
		put(t, filepath.Join(project, "agent-docs/reports", fmt.Sprintf("%02d.md", n)), fmt.Sprintf("---\ntitle: R\nkind: report\nat: %s\n---\n", time.Unix(int64(n), 0).UTC().Format(time.RFC3339)))
	}
	s := index.Snapshot(dir, false, nil)
	if len(s.Details["demo"].Tasks) != 500 || len(s.Details["demo"].Reports) != 50 || s.Projects[0].LatestReport.File != "51.md" {
		t.Fatal("limits or order")
	}
	put(t, filepath.Join(project, "project.json"), `{"id":"demo","status":"archived"}`)
	if len(index.Snapshot(dir, false, nil).Projects) != 0 || len(index.Snapshot(dir, true, nil).Projects) != 1 {
		t.Fatal("archived filter")
	}
}
