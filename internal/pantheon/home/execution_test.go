package home

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestHomeExecutionMetaDefaultsAndValidation(t *testing.T) {
	dir, _ := fixture(t)
	var index Index
	d := index.Snapshot(dir, false, nil).Details["demo"]
	if d.Project.Meta.Autonomy != "off" || d.Project.Meta.MaxAttempts != 2 || d.Project.Meta.AttemptMinutes != 30 || d.Project.Meta.VerifyScope != "auto" {
		t.Fatalf("defaults: %+v", d.Project.Meta)
	}
	autonomy, stages, merge, attempts, minutes, scope := "stage", []string{"E1"}, true, 3, 120, "off"
	meta, rev, err := index.PatchMeta(dir, "demo", PatchMeta{Autonomy: &autonomy, ApprovedStages: &stages, AutoMerge: &merge, MaxAttempts: &attempts, AttemptMinutes: &minutes, VerifyScope: &scope})
	if err != nil || meta.Autonomy != "stage" || !meta.AutoMerge || meta.MaxAttempts != 3 || rev == "" {
		t.Fatal(meta, err)
	}
	badAutonomy, badScope, badAttempts, badMinutes := "sometimes", "required", 4, 4
	for _, patch := range []PatchMeta{{Autonomy: &badAutonomy}, {VerifyScope: &badScope}, {MaxAttempts: &badAttempts}, {AttemptMinutes: &badMinutes}} {
		patch.Rev = rev
		if _, _, err := index.PatchMeta(dir, "demo", patch); err == nil {
			t.Fatal("accepted invalid execution metadata", patch)
		}
	}
	if _, _, err := index.PatchMeta(dir, "demo", PatchMeta{Rev: "old", Autonomy: &autonomy}); err == nil {
		t.Fatal("stale metadata")
	}
}

func TestHomeExecutionEligibility(t *testing.T) {
	detail := Detail{Project: Project{Meta: DefaultMeta()}, Tasks: []Task{
		{ID: "done", Status: "done"},
		{ID: "waiting", Status: "planned", Stage: "E1", DependsOn: []string{"missing"}, Priority: "P0"},
		{ID: "old", Status: "planned", Stage: "E1", Priority: "P1", Updated: "2026-01-01T00:00:00Z"},
		{ID: "new", Status: "planned", Stage: "E1", Priority: "P1", Updated: "2026-02-01T00:00:00Z"},
		{ID: "first", Status: "planned", Stage: "E1", DependsOn: []string{"done"}, Priority: "P0"},
		{ID: "none", Status: "planned", Stage: "E2"},
	}}
	ids := func(manual bool) []string {
		out := []string{}
		for _, task := range EligibleTasks(detail, manual) {
			out = append(out, task.ID)
		}
		return out
	}
	if len(ids(false)) != 0 {
		t.Fatal("off autonomy scheduled work")
	}
	if got := ids(true); !reflect.DeepEqual(got, []string{"first", "old", "new", "none"}) {
		t.Fatal(got)
	}
	detail.Project.Meta.Autonomy = "stage"
	if len(ids(false)) != 0 {
		t.Fatal("unapproved stage")
	}
	detail.Project.Meta.ApprovedStages = []string{"E1"}
	if got := ids(false); !reflect.DeepEqual(got, []string{"first", "old", "new"}) {
		t.Fatal(got)
	}
	detail.Project.Meta.Autonomy = "full"
	if len(ids(false)) != 4 {
		t.Fatal("full autonomy")
	}
}

func TestHomeExecutionReceiptsAreNumberedAndIdempotent(t *testing.T) {
	dir, project := fixture(t)
	var index Index
	if _, err := index.Create(dir, "demo", CreateTask{ID: "T1", Title: "Receipt"}); err != nil {
		t.Fatal(err)
	}
	put(t, filepath.Join(project, "agent-docs/tasks/T1/handoff-003.md"), "old handoff")
	for n := 0; n < 2; n++ {
		name, err := index.AppendHandoff(dir, "demo", "T1", "run1", "receipt evidence")
		if err != nil || name != "handoff-004.md" {
			t.Fatal(name, err)
		}
	}
	name, body, err := index.Handoff(dir, "demo", "T1", "")
	if err != nil || name != "handoff-004.md" || !strings.Contains(body, "receipt evidence") {
		t.Fatal(name, body, err)
	}
	report := ExecutionReport{Key: "run1", File: "2026-10-10-10-10-run-T1.md", Title: "Report", At: time.Now(), NeedsUser: true}
	for n := 0; n < 2; n++ {
		name, err := index.WriteExecutionReport(dir, "demo", report)
		if err != nil || name != report.File {
			t.Fatal(name, err)
		}
	}
	report.Key = "run2"
	if name, err := index.WriteExecutionReport(dir, "demo", report); err != nil || name != "2026-10-10-10-10-run-T1-2.md" {
		t.Fatal(name, err)
	}
	files, _ := os.ReadDir(filepath.Join(project, "agent-docs/reports"))
	if len(files) != 2 {
		t.Fatal("report duplication", len(files))
	}
}

func TestHomeExecutionReceiptSymlinkEscape(t *testing.T) {
	dir, project := fixture(t)
	var index Index
	if _, err := index.Create(dir, "demo", CreateTask{ID: "T1", Title: "Receipt"}); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(dir, "outside.md")
	put(t, outside, "private")
	if err := os.Symlink(outside, filepath.Join(project, "agent-docs/tasks/T1/handoff-001.md")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := index.Handoff(dir, "demo", "T1", ""); err == nil {
		t.Fatal("read escaped handoff")
	}
}
