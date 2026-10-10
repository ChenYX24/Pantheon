package home

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestHomeFieldsDefaultsRevisionAndValidation(t *testing.T) {
	dir, project := fixture(t)
	var index Index
	fields, rev, err := index.Fields(dir)
	if err != nil || rev != "" || !reflect.DeepEqual(fields, DefaultFields()) {
		t.Fatalf("defaults: %+v %s %v", fields, rev, err)
	}
	fields.Task["status"].Options[0].Label = "Ready"
	fields.Task["tags"] = Field{Options: []FieldOption{{Value: "custom", Color: "yellow"}}}
	rev, err = index.PutFields(dir, rev, fields)
	if err != nil || len(rev) != 16 {
		t.Fatal(rev, err)
	}
	got, savedRev, err := index.Fields(dir)
	if err != nil || savedRev != rev || !reflect.DeepEqual(got, fields) {
		t.Fatal("round trip", got, savedRev, err)
	}
	_, err = index.PutFields(dir, "", fields)
	var stale *StaleError
	if !errors.As(err, &stale) || stale.Rev != rev {
		t.Fatal("stale", err)
	}
	for _, change := range []func(*Fields){
		func(f *Fields) { delete(f.Task, "tags") },
		func(f *Fields) { f.Task["status"].Options[0].Value = "unknown" },
		func(f *Fields) { f.Project["phase"].Options[0].Color = "invisible" },
		func(f *Fields) {
			f.Task["tags"] = Field{Options: []FieldOption{{Value: "x", Color: "red"}, {Value: "x", Color: "blue"}}}
		},
		func(f *Fields) { f.Project["labels"] = Field{} },
	} {
		invalid := DefaultFields()
		change(&invalid)
		if _, err = index.PutFields(dir, rev, invalid); err == nil {
			t.Fatal("invalid fields accepted", invalid)
		}
	}
	// A fields symlink must obey the same boundary as task files.
	path := filepath.Join(filepath.Dir(filepath.Dir(project)), "pantheon/fields.json")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(dir, "outside.json")
	put(t, outside, `{}`)
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	if _, err = index.PutFields(dir, Revision([]byte(`{}`)), fields); err == nil {
		t.Fatal("escaped fields root")
	}
}

func TestHomeTaskFieldsPreserveUnchangedBytes(t *testing.T) {
	dir, project := fixture(t)
	var index Index
	path := filepath.Join(project, "agent-docs/tasks/A2/task.md")
	original := "---\r\nid: A2\r\n# keep comment\r\ntitle: Old\r\nstatus: planned\r\nunknown:  'keep  spaces' # keep\r\n---\r\nBody with trailing spaces  \r\n"
	put(t, path, original)
	title, stage, priority, owner, due, primary, secondary := "New # title", "A.2", "custom-priority", "codex", "2026-10-12", "codex/model", "claude/other"
	tags, deps := []string{"前端", "comma, tag", "quote\" tag"}, []string{"A1", "T-2"}
	got, err := index.Patch(dir, "demo", "A2", PatchTask{Rev: Revision([]byte(original)), Title: &title, Stage: &stage, Priority: &priority, Tags: &tags, Owner: &owner, Due: &due, Primary: &primary, Secondary: &secondary, DependsOn: &deps})
	if err != nil || got.Title != title || got.Stage != stage || got.Priority != priority || got.Owner != owner || got.Due != due || got.Primary != primary || got.Secondary != secondary || !reflect.DeepEqual(got.Tags, tags) || !reflect.DeepEqual(got.DependsOn, deps) {
		t.Fatalf("%+v %v", got, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"# keep comment\r\n", "unknown:  'keep  spaces' # keep\r\n", "---\r\nBody with trailing spaces  \r\n"} {
		if !strings.Contains(string(data), part) {
			t.Fatal("bytes changed", part, string(data))
		}
	}
	if !strings.Contains(string(data), `tags: ["前端","comma, tag","quote\" tag"]`) {
		t.Fatal("tags are not a list", string(data))
	}
	invalid := "2026-02-30"
	if _, err = index.Patch(dir, "demo", "A2", PatchTask{Rev: got.Rev, Due: &invalid}); err == nil {
		t.Fatal("invalid date")
	}
	tags = []string{}
	got, err = index.Patch(dir, "demo", "A2", PatchTask{Rev: got.Rev, Tags: &tags})
	if err != nil || got.Tags == nil || len(got.Tags) != 0 {
		t.Fatal("clear tags", err)
	}
}

func TestHomeMetaCreateStaleAndPinnedOrder(t *testing.T) {
	dir, project := fixture(t)
	put(t, filepath.Join(filepath.Dir(project), "other/project.json"), `{"id":"other","status":"active"}`)
	var index Index
	pinned := true
	labels := []string{"custom"}
	priority := "P0"
	meta, rev, err := index.PatchMeta(dir, "demo", PatchMeta{Labels: &labels, Priority: &priority, Pinned: &pinned})
	if err != nil || !meta.Pinned || meta.Priority != "P0" || len(rev) != 16 {
		t.Fatal(meta, rev, err)
	}
	if _, _, err = index.PatchMeta(dir, "demo", PatchMeta{}); err == nil {
		t.Fatal("stale create")
	}
	snapshot := index.Snapshot(dir, false, nil)
	if snapshot.Projects[0].ID != "demo" || snapshot.Projects[0].MetaRev != rev || !reflect.DeepEqual(snapshot.Projects[0].Meta.Labels, labels) {
		t.Fatal(snapshot.Projects)
	}
	owner := "cyx"
	meta, _, err = index.PatchMeta(dir, "demo", PatchMeta{Rev: rev, Owner: &owner})
	if err != nil || meta.Owner != owner || !meta.Pinned || !reflect.DeepEqual(meta.Labels, labels) {
		t.Fatal("partial patch", meta, err)
	}
}

func TestHomeReportReplyPreservesFileAndClearsTodo(t *testing.T) {
	dir, project := fixture(t)
	var index Index
	path := filepath.Join(project, "agent-docs/reports/q.md")
	original := "---\r\ntitle: A question\r\nkind: question\r\nneeds_user: true\r\ncustom: unchanged # yes\r\n---\r\nOriginal body  \r\n"
	put(t, path, original)
	rev := Revision([]byte(original))
	got, err := index.ReplyReport(dir, "demo", "q.md", "请继续\n\nSecond paragraph", &rev)
	if err != nil || got.NeedsUser || got.Rev == rev || len(got.Replies) != 1 || got.Replies[0].Text != "请继续\n\nSecond paragraph" {
		t.Fatalf("%+v %v", got, err)
	}
	data, _ := os.ReadFile(path)
	prefix := strings.Replace(original, "needs_user: true", "needs_user: false", 1)
	if !strings.HasPrefix(string(data), prefix+"\n\n## 回复 · ") {
		t.Fatal("changed unrelated bytes", string(data))
	}
	if _, err = index.ReplyReport(dir, "demo", "q.md", "stale", &rev); err == nil {
		t.Fatal("stale reply")
	}
	got, err = index.ReplyReport(dir, "demo", "q.md", "No revision required", nil)
	if err != nil || len(got.Replies) != 2 {
		t.Fatal("second reply", err)
	}
	if snapshot := index.Snapshot(dir, false, nil); len(snapshot.Todos) != 0 {
		t.Fatal("question still open", snapshot.Todos)
	}
	for _, file := range []string{"../q.md", "bad.txt", "x/y.md"} {
		if _, err = index.ReplyReport(dir, "demo", file, "no", nil); err == nil {
			t.Fatal("bad path", file)
		}
	}
}
