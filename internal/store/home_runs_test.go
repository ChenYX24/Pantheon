package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestHomeRunsClaimCapacityAndHistory(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	run := HomeRun{ID: "first", ProjectID: "file-project", TaskID: "T1", State: "running", Attempt: 1, Checks: []HomeCheck{}}
	if err := db.ClaimHomeRun(ctx, run, 2); err != nil {
		t.Fatal(err)
	}
	run.ID = "same-project"
	if err := db.ClaimHomeRun(ctx, run, 2); !errors.Is(err, ErrHomeRunBusy) {
		t.Fatal("second project writer", err)
	}
	run.ID, run.ProjectID = "second", "another-project"
	if err := db.ClaimHomeRun(ctx, run, 2); err != nil {
		t.Fatal(err)
	}
	run.ID, run.ProjectID = "third", "third-project"
	if err := db.ClaimHomeRun(ctx, run, 2); !errors.Is(err, ErrHomeRunBusy) {
		t.Fatal("instance cap", err)
	}
	first, err := db.HomeRun(ctx, "file-project", "first")
	if err != nil || first.Checks == nil {
		t.Fatal(first, err)
	}
	first.State, first.Reviewer = "reviewing", "claude/reviewer"
	if err := db.UpdateHomeRun(ctx, first); err != nil {
		t.Fatal(err)
	}
	if err := db.ClaimHomeRun(ctx, run, 2); !errors.Is(err, ErrHomeRunBusy) {
		t.Fatal("review retains capacity", err)
	}
	first.State = "accepted"
	first.Checks = []HomeCheck{{Command: "true", Output: "passed", ExitCode: 0}}
	if err := db.UpdateHomeRun(ctx, first); err != nil {
		t.Fatal(err)
	}
	if _, err := db.HomeRun(ctx, "wrong-project", "first"); !errors.Is(err, ErrNotFound) {
		t.Fatal("run crossed project boundary", err)
	}
	for n := 0; n < 52; n++ {
		run.ID, run.ProjectID, run.StartedAt = fmt.Sprintf("run-%d", n), "file-project", int64(n)
		if err := db.ClaimHomeRun(ctx, run, 2); err != nil {
			t.Fatal(err)
		}
		run.State = "failed"
		if err := db.UpdateHomeRun(ctx, run); err != nil {
			t.Fatal(err)
		}
		run.State = "running"
	}
	history, err := db.HomeRuns(ctx, "file-project")
	if err != nil || len(history) != 50 || history[0].ID != "run-51" {
		t.Fatal("history", len(history), err)
	}
}

func TestHomeRunPartialIndexGuardsDirectWrites(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	run := HomeRun{ID: "a", ProjectID: "p", State: "running"}
	if err := db.ClaimHomeRun(ctx, run, 2); err != nil {
		t.Fatal(err)
	}
	run.State = "accepted"
	if err := db.UpdateHomeRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	run.ID, run.State = "b", "running"
	if err := db.ClaimHomeRun(ctx, run, 2); err != nil {
		t.Fatal(err)
	}
	run.ID, run.State = "a", "reviewing"
	if err := db.UpdateHomeRun(ctx, run); err == nil {
		t.Fatal("partial unique index allowed two writers")
	}
}
