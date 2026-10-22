package home

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// cyx keeps each project's progress in a repository of its own, checked out at
// progress/<id> inside the harness, with projects/<id> a link to the checkout
// and the checkout's project.json a link back to registry/<id>.json. Nothing in
// this package knows that, and the panel that was running when the harness
// moved could not have: this pins that it does not need to. Every read follows
// the links, and every write -- a task, the meta rename, a handoff -- lands in
// the checkout, where the progress repository commits it, rather than
// replacing a link and stranding the file in the harness.
func TestHomeFollowsCyxProgressLinks(t *testing.T) {
	dir := t.TempDir()
	harness := filepath.Join(dir, "harness")
	checkout := filepath.Join(harness, "progress", "demo")
	put(t, filepath.Join(harness, "registry", "demo.json"), `{"id":"demo","aliases":["Demo"],"status":"active","state_mode":"linked","sync":"github","progress":"https://github.com/cyx-progress/demo.git"}`)
	put(t, filepath.Join(checkout, "ACTIVE_CONTEXT.md"), "# demo\n\n- **Goal**: progress in its own repository\n")
	for link, target := range map[string]string{
		filepath.Join(checkout, "project.json"):    "../../registry/demo.json",
		filepath.Join(harness, "projects", "demo"): "../progress/demo",
	} {
		if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
	}
	local, _ := json.Marshal(map[string]any{"version": 1, "paths": map[string]string{"cyx-agent-harness": harness, "demo": dir}})
	put(t, filepath.Join(dir, "local.json"), string(local))

	var index Index
	snapshot := index.Snapshot(dir, false, nil)
	if len(snapshot.Projects) != 1 || snapshot.Projects[0].ID != "demo" || len(snapshot.Warnings) != 0 {
		t.Fatal(snapshot.Projects, snapshot.Warnings)
	}
	inCheckout := func(path string) {
		t.Helper()
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil || !strings.HasPrefix(resolved, checkout+string(filepath.Separator)) {
			t.Fatalf("%s resolves to %s (%v), not inside %s", path, resolved, err, checkout)
		}
		info, err := os.Lstat(resolved)
		if err != nil || !info.Mode().IsRegular() && !info.IsDir() {
			t.Fatal(resolved, info, err)
		}
	}

	phase := "实施"
	if _, _, err := index.PatchMeta(dir, "demo", PatchMeta{Phase: &phase}); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(filepath.Join(checkout, "pantheon.json")); err != nil || !info.Mode().IsRegular() {
		t.Fatal("the meta rename did not land in the checkout", info, err)
	}
	task, err := index.Create(dir, "demo", CreateTask{ID: "T1", Title: "Move the progress"})
	if err != nil {
		t.Fatal(err)
	}
	inCheckout(filepath.Join(harness, "projects", "demo", task.File))
	handoff, project, err := index.RolloverHandoff(dir, dir, "session-1", time.Now())
	if err != nil || project != "demo" {
		t.Fatal(handoff, project, err)
	}
	inCheckout(filepath.Dir(handoff))

	// The links themselves survived every write.
	for _, link := range []string{filepath.Join(harness, "projects", "demo"), filepath.Join(checkout, "project.json")} {
		if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
			t.Fatal("replaced:", link, err)
		}
	}
	if _, err := os.Lstat(filepath.Join(harness, "projects", "pantheon.json")); !os.IsNotExist(err) {
		t.Fatal("a file was written beside the link", err)
	}
}
