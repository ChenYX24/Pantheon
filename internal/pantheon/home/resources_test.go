package home

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func resourceFields(t *testing.T, raw string) map[string]json.RawMessage {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		t.Fatal(err)
	}
	return fields
}

func TestHomeResourcesFilesRevisionAndIndex(t *testing.T) {
	dir, _ := fixture(t)
	var index Index
	r, err := index.CreateResource(dir, resourceFields(t, `{"title":"OpenAI Main","kind":"api","env":["OPENAI_API_KEY"],"body":"## 用途\nA | purpose\n"}`))
	if err != nil {
		t.Fatal(err)
	}
	if r.ID != "openai-main" || r.Check != "none" || !r.Allows("demo") || len(r.Rev) != 16 {
		t.Fatalf("%+v", r)
	}
	if _, err := index.CreateResource(dir, resourceFields(t, `{"title":"OpenAI Main","kind":"api"}`)); !errors.Is(err, ErrExists) {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "harness", r.File)
	original := "---\r\nid: openai-main\r\nkind: api # keep\r\ntitle: Old\r\nenv: [OPENAI_API_KEY]\r\nprojects: [demo]\r\nunknown: \"keep # bytes\"\r\n# comment\r\n---\r\n## 用途\r\nOriginal body\r\n"
	put(t, file, original)
	r, err = index.PatchResource(dir, r.ID, Revision([]byte(original)), resourceFields(t, `{"title":"New # title","tags":["模型","with, comma"]}`))
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(file)
	for _, exact := range []string{"kind: api # keep\r\n", "unknown: \"keep # bytes\"\r\n# comment\r\n", "---\r\n## 用途\r\nOriginal body\r\n"} {
		if !strings.Contains(string(data), exact) {
			t.Fatalf("lost original bytes: %q", data)
		}
	}
	if r.Title != "New # title" || r.Tags[1] != "with, comma" || r.Allows("other") {
		t.Fatalf("%+v", r)
	}
	var stale *StaleError
	if _, err = index.PatchResource(dir, r.ID, "old", resourceFields(t, `{"body":"replacement"}`)); !errors.As(err, &stale) || stale.Rev != r.Rev {
		t.Fatal(err)
	}
	readme, err := os.ReadFile(filepath.Join(dir, "harness/pantheon/resources/README.md"))
	if err != nil || !strings.Contains(string(readme), "New # title") || !strings.Contains(string(readme), "Original body") || !strings.Contains(string(readme), "OPENAI_API_KEY") {
		t.Fatalf("%s %v", readme, err)
	}
	if err := index.DeleteResource(dir, r.ID, "stale"); !errors.As(err, &stale) {
		t.Fatal(err)
	}
	if err := index.DeleteResource(dir, r.ID, r.Rev); err != nil {
		t.Fatal(err)
	}
	if _, err := index.Resource(dir, r.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	readme, _ = os.ReadFile(filepath.Join(dir, "harness/pantheon/resources/README.md"))
	if strings.Contains(string(readme), r.ID) {
		t.Fatal("deleted resource remains in index")
	}
}

func TestHomeResourcesValidationWarningsAndBoundary(t *testing.T) {
	dir, _ := fixture(t)
	var index Index
	for _, raw := range []string{
		`{"id":"../escape","kind":"api","title":"X"}`,
		`{"id":"Upper","kind":"api","title":"X"}`,
		`{"kind":"invalid","title":"X"}`,
		`{"kind":"api","title":""}`,
		`{"kind":"api","title":"X","env":["lower"]}`,
		`{"kind":"api","title":"X","projects":["../bad"]}`,
		`{"kind":"api","title":"X","env":"KEY"}`,
		`{"kind":"api","title":"X","check":"timer"}`,
	} {
		if _, err := index.CreateResource(dir, resourceFields(t, raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	r, err := index.CreateResource(dir, resourceFields(t, `{"kind":"server","title":"服务器","ssh_alias":"node"}`))
	if err != nil || !ValidResourceID(r.ID) || r.GPUBoardID != "node" {
		t.Fatalf("%+v %v", r, err)
	}
	base := filepath.Join(dir, "harness/pantheon/resources")
	put(t, filepath.Join(base, "bad.md"), "---\nid: mismatch\nkind: other\ntitle: bad\n---\n")
	outside := filepath.Join(dir, "outside.md")
	put(t, outside, "---\nid: escape\nkind: other\ntitle: Outside\n---\n")
	if err := os.Symlink(outside, filepath.Join(base, "escape.md")); err != nil {
		t.Fatal(err)
	}
	resources, warnings, err := index.Resources(dir)
	if err != nil || len(resources) != 1 || len(warnings) != 2 {
		t.Fatalf("%+v %+v %v", resources, warnings, err)
	}
	if _, err := index.PatchResource(dir, "escape", Revision([]byte("")), resourceFields(t, `{"title":"Changed"}`)); err == nil {
		t.Fatal("followed escaping link")
	}
	if err := index.DeleteResource(dir, "escape", ""); err == nil {
		t.Fatal("deleted escaping link")
	}
	if _, err := index.CreateResource(dir, resourceFields(t, `{"id":"escape","kind":"other","title":"Collision"}`)); !errors.Is(err, ErrExists) {
		t.Fatal(err)
	}
}

func TestHomeResourcePatchFreshBytesAndBody(t *testing.T) {
	dir, _ := fixture(t)
	var index Index
	r, err := index.CreateResource(dir, resourceFields(t, `{"id":"same","title":"Alpha","kind":"other"}`))
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "harness", r.File)
	info, _ := os.Stat(file)
	data, _ := os.ReadFile(file)
	put(t, file, strings.Replace(string(data), "Alpha", "Bravo", 1))
	if err := os.Chtimes(file, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	var stale *StaleError
	if _, err := index.PatchResource(dir, r.ID, r.Rev, resourceFields(t, `{"body":"New body"}`)); !errors.As(err, &stale) {
		t.Fatalf("mtime-preserving edit missed: %v", err)
	}
	r, err = index.PatchResource(dir, r.ID, stale.Rev, resourceFields(t, `{"body":"New body","custom":"New custom field","custom_list":["one","with, comma"]}`))
	if err != nil || r.Body != "New body" || r.Title != "Bravo" {
		t.Fatalf("%+v %v", r, err)
	}
	data, _ = os.ReadFile(file)
	if !strings.Contains(string(data), `custom_list: ["one","with, comma"]`) {
		t.Fatal("unknown list was not preserved")
	}
	if _, err := index.PatchResource(dir, r.ID, r.Rev, resourceFields(t, `{"id":"renamed"}`)); err == nil {
		t.Fatal("renamed without changing filename")
	}
}

func TestHomeResourceDefaultsInProjectMeta(t *testing.T) {
	dir, _ := fixture(t)
	var index Index
	ids := []string{"api", "node"}
	meta, rev, err := index.PatchMeta(dir, "demo", PatchMeta{Resources: &ids})
	if err != nil || len(meta.Resources) != 2 {
		t.Fatalf("%+v %v", meta, err)
	}
	owner := "me"
	meta, _, err = index.PatchMeta(dir, "demo", PatchMeta{Rev: rev, Owner: &owner})
	if err != nil || len(meta.Resources) != 2 {
		t.Fatal("unrelated edit lost defaults", err)
	}
	if got := index.Snapshot(dir, false, nil).Projects[0].Meta.Resources; len(got) != 2 {
		t.Fatal(got)
	}
}
