package store

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func runningWorkflowFixture(t *testing.T) (*DB, WorkflowRun) {
	t.Helper()
	db, board := workflowFixture(t)
	ctx := context.Background()
	if _, err := db.ApproveStage(ctx, "p", "P1", "fixture-owner", board.Rev); err != nil {
		t.Fatal(err)
	}
	run, _, _, _, err := db.ClaimNext(ctx, "p")
	if err != nil {
		t.Fatal(err)
	}
	run.State, run.SessionID = "running", "fixture-session"
	run.Workspace = filepath.Join(t.TempDir(), "workspace")
	if err := db.UpdateWorkflowRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	return db, run
}

func workflowSnapshot(t *testing.T, db *DB) (ProjectBoard, WorkflowView) {
	t.Helper()
	board, err := db.GetProjectBoard(context.Background(), "p")
	if err != nil {
		t.Fatal(err)
	}
	view, err := db.WorkflowView(context.Background(), "p")
	if err != nil {
		t.Fatal(err)
	}
	return board, view
}

// A reconnect can replay an old progress receipt after the result was saved.
// Terminal state, task evidence and the one-writer slot must all stay finished.
func TestWorkflowLifecycleLateProgressCannotReopenTerminalRun(t *testing.T) {
	for _, terminal := range []string{"done", "review", "blocked"} {
		t.Run(terminal, func(t *testing.T) {
			db, progress := runningWorkflowFixture(t)
			result := progress
			result.State, result.Summary = terminal, "fixture terminal evidence"
			if err := db.FinishWorkflowRun(context.Background(), result); err != nil {
				t.Fatal(err)
			}
			board, view := workflowSnapshot(t, db)
			if err := db.UpdateWorkflowRun(context.Background(), progress); !errors.Is(err, ErrWorkflowBusy) {
				t.Errorf("late progress must be refused, got %v", err)
			}
			afterBoard, afterView := workflowSnapshot(t, db)
			if !reflect.DeepEqual(board, afterBoard) || !reflect.DeepEqual(view, afterView) {
				t.Error("late progress changed terminal history or task evidence")
			}
			active, err := db.ActiveWorkflowRuns(context.Background())
			if err != nil || len(active) != 0 {
				t.Fatalf("terminal run reclaimed the writer slot: %v / %v", active, err)
			}
		})
	}
}

func TestWorkflowLifecycleReceiptsCannotRebindRun(t *testing.T) {
	changes := []struct {
		name string
		edit func(*WorkflowRun)
	}{
		{"project", func(r *WorkflowRun) { r.ProjectID = "other" }},
		{"task", func(r *WorkflowRun) { r.TaskID = "b" }},
		{"stage", func(r *WorkflowRun) { r.StageID = "other" }},
		{"approval", func(r *WorkflowRun) { r.ApprovalID = "other" }},
		{"session", func(r *WorkflowRun) { r.SessionID = "other" }},
		{"workspace", func(r *WorkflowRun) { r.Workspace += "-other" }},
		{"start", func(r *WorkflowRun) { r.StartedAt++ }},
		{"deadline", func(r *WorkflowRun) { r.Deadline++ }},
	}
	for _, operation := range []string{"progress", "result"} {
		for _, change := range changes {
			t.Run(operation+"/"+change.name, func(t *testing.T) {
				db, run := runningWorkflowFixture(t)
				beforeBoard, beforeView := workflowSnapshot(t, db)
				change.edit(&run)
				var err error
				if operation == "progress" {
					err = db.UpdateWorkflowRun(context.Background(), run)
				} else {
					run.State, run.Summary = "done", "unrelated receipt"
					err = db.FinishWorkflowRun(context.Background(), run)
				}
				if err == nil {
					t.Error("mismatched receipt was accepted")
				}
				afterBoard, afterView := workflowSnapshot(t, db)
				if !reflect.DeepEqual(beforeBoard, afterBoard) || !reflect.DeepEqual(beforeView, afterView) {
					t.Error("mismatched receipt changed canonical state")
				}
			})
		}
	}
}

func TestWorkflowLifecycleProgressCannotFinalize(t *testing.T) {
	db, run := runningWorkflowFixture(t)
	beforeBoard, beforeView := workflowSnapshot(t, db)
	run.State = "done"
	if err := db.UpdateWorkflowRun(context.Background(), run); err == nil {
		t.Error("progress endpoint accepted a terminal state without task finalization")
	}
	afterBoard, afterView := workflowSnapshot(t, db)
	if !reflect.DeepEqual(beforeBoard, afterBoard) || !reflect.DeepEqual(beforeView, afterView) {
		t.Error("invalid progress changed canonical state")
	}
}

// The reconciler may have read 'running' immediately before PauseStage commits.
// Checking only that old in-memory state loses a real, persisted pause request.
func TestWorkflowLifecyclePersistedPauseWinsCompletion(t *testing.T) {
	db, cached := runningWorkflowFixture(t)
	ctx := context.Background()
	if err := db.PauseStage(ctx, "p", "P1"); err != nil {
		t.Fatal(err)
	}
	_, pending := workflowSnapshot(t, db)
	if pending.Runs[0].State != "stopping" || pending.Runs[0].FinishedAt != 0 {
		t.Fatal("requesting pause must not claim that the worker has already stopped")
	}
	cached.State, cached.Summary = "done", "worker returned a late successful result"
	if err := db.FinishWorkflowRun(ctx, cached); err != nil {
		t.Fatal(err)
	}
	board, view := workflowSnapshot(t, db)
	run := view.Runs[0]
	if run.State != "blocked" || !strings.HasPrefix(run.Summary, "Paused. ") {
		t.Errorf("persisted pause was lost: %+v", run)
	}
	if board.Tasks[0].Status != "blocked" || board.Tasks[0].SessionID != cached.SessionID {
		t.Errorf("task/session disagrees with paused run: %+v", board.Tasks[0])
	}
	if run.FinishedAt == 0 {
		t.Error("result has no terminal timestamp")
	}
	for _, event := range view.Events {
		if event.Kind == "task.finished" && !strings.Contains(event.Body, "blocked") {
			t.Error("event falsely claims success after pause")
		}
	}
}

func TestWorkflowLifecycleDuplicateResultAndReopenPreserveHistory(t *testing.T) {
	db, run := runningWorkflowFixture(t)
	ctx := context.Background()
	run.State, run.Summary = "blocked", "fixture verification failed; work preserved"
	if err := db.FinishWorkflowRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	board, view := workflowSnapshot(t, db)
	if err := db.PauseStage(ctx, "p", "P1"); err != nil {
		t.Fatal(err)
	}
	// Approval changes independently; compare terminal history and task evidence.
	board, view = workflowSnapshot(t, db)
	var wg sync.WaitGroup
	errorsSeen := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			duplicate := run
			duplicate.State, duplicate.Summary = "done", "conflicting duplicate"
			errorsSeen <- db.FinishWorkflowRun(ctx, duplicate)
		}()
	}
	wg.Wait()
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil {
			t.Fatal(err)
		}
	}
	var raw, path string
	var finished int64
	if err := db.sql.QueryRowContext(ctx, `SELECT content,finished_at FROM pm_runs WHERE id=?`, run.ID).Scan(&raw, &finished); err != nil {
		t.Fatal(err)
	}
	var receipt WorkflowRun
	if err := json.Unmarshal([]byte(raw), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.FinishedAt != finished || finished == 0 {
		t.Errorf("serialized receipt and historical timestamp disagree: %d / %d", receipt.FinishedAt, finished)
	}
	if err := db.sql.QueryRowContext(ctx, `SELECT file FROM pragma_database_list WHERE name='main'`).Scan(&path); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	again, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	afterBoard, afterView := workflowSnapshot(t, again)
	if !reflect.DeepEqual(board, afterBoard) || !reflect.DeepEqual(view, afterView) {
		t.Fatal("duplicate result or reopen changed saved history")
	}
	finishedEvents := 0
	for _, event := range afterView.Events {
		if event.Kind == "task.finished" {
			finishedEvents++
		}
	}
	if finishedEvents != 1 {
		t.Fatalf("result was applied %d times", finishedEvents)
	}
}
