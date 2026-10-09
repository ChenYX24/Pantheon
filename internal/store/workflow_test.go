package store

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func workflowFixture(t *testing.T) (*DB, ProjectBoard) {
	t.Helper()
	db := openTest(t)
	ctx := context.Background()
	if _, err := db.CreateProject(ctx, "p", "Project", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	b := ProjectBoard{ProjectID: "p", Goal: "Ship safely", Stages: []BoardStage{{ID: "P1", Title: "Implement", Primary: ModelAssignment{"codex", "test-codex"}, Secondary: ModelAssignment{"claude", "test-claude"}, BudgetMinutes: 120, AttemptMinutes: 30, MaxAttempts: 3}}, Tasks: []BoardTask{{ID: "a", Title: "First", Phase: "P1", Status: "ready", Acceptance: "checks pass", Verify: []string{"true"}}, {ID: "b", Title: "Second", Phase: "P1", Status: "ready", Acceptance: "checks pass", DependsOn: []string{"a"}, Verify: []string{"true"}}}}
	var err error
	b, err = db.SaveProjectBoard(ctx, b)
	if err != nil {
		t.Fatal(err)
	}
	return db, b
}
func TestWorkflowClaimsAreAtomicAndRequireApproval(t *testing.T) {
	db, b := workflowFixture(t)
	ctx := context.Background()
	if _, _, _, _, err := db.ClaimNext(ctx, "p"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unapproved task: %v", err)
	}
	a, err := db.ApproveStage(ctx, "p", "P1", "owner", b.Rev)
	if err != nil {
		t.Fatal(err)
	}
	again, err := db.ApproveStage(ctx, "p", "P1", "owner", b.Rev)
	if err != nil || again.ID != a.ID {
		t.Fatalf("duplicate approval: %v", err)
	}
	var wg sync.WaitGroup
	runs := make(chan WorkflowRun, 8)
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, _, _, _, err := db.ClaimNext(ctx, "p")
			if err == nil {
				runs <- r
			} else {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(runs)
	close(errs)
	if len(runs) != 1 {
		t.Fatalf("%d concurrent claims won", len(runs))
	}
	for err := range errs {
		if !errors.Is(err, ErrWorkflowBusy) && !errors.Is(err, ErrBoardStale) {
			t.Fatal(err)
		}
	}
	r := <-runs
	if r.TaskID != "a" {
		t.Fatalf("dependency violated: %s", r.TaskID)
	}
	if _, err = db.SaveProjectBoard(ctx, b); !errors.Is(err, ErrWorkflowBusy) && !errors.Is(err, ErrBoardStale) {
		t.Fatalf("edited active plan: %v", err)
	}
	r.State = "done"
	r.Summary = "true passed; independent review passed"
	if err = db.FinishWorkflowRun(ctx, r); err != nil {
		t.Fatal(err)
	}
	next, _, _, _, err := db.ClaimNext(ctx, "p")
	if err != nil || next.TaskID != "b" {
		t.Fatalf("next dependency: %+v %v", next, err)
	}
	if err = db.PauseStage(ctx, "p", "P1"); err != nil {
		t.Fatal(err)
	}
	active, err := db.ActiveWorkflowRuns(ctx)
	if err != nil || len(active) != 1 || active[0].State != "stopping" {
		t.Fatalf("pause lost execution: %+v %v", active, err)
	}
}
func TestWorkflowRevisionAndCapabilityInvalidation(t *testing.T) {
	db, b := workflowFixture(t)
	ctx := context.Background()
	if _, err := db.ApproveStage(ctx, "p", "P1", "owner", b.Rev); err != nil {
		t.Fatal(err)
	}
	c, err := db.SaveCapability(ctx, "p", Capability{Name: "shared handoff", Kind: "skill", Content: "Preserve verified evidence"})
	if err != nil {
		t.Fatal(err)
	}
	c2, err := db.SaveCapability(ctx, "p", Capability{Name: c.Name, Kind: c.Kind, Content: "New revision"})
	if err != nil || c2.Revision != 2 {
		t.Fatalf("revision: %+v %v", c2, err)
	}
	if err = db.ActivateCapability(ctx, "p", c2.ID, c2.Revision); err != nil {
		t.Fatal(err)
	}
	if _, _, _, _, err = db.ClaimNext(ctx, "p"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old capability approval still executes: %v", err)
	}
	if _, err = db.ApproveStage(ctx, "p", "P1", "owner", b.Rev); !errors.Is(err, ErrBoardStale) {
		t.Fatalf("old revision accepted: %v", err)
	}
	v, err := db.WorkflowView(ctx, "p")
	if err != nil || len(v.Capabilities) != 2 {
		t.Fatalf("view: %+v %v", v, err)
	}
	_, err = db.AddWorkflowMessage(ctx, "p", "user", "status?", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.AddWorkflowMessage(ctx, "p", "assistant", "pending", &b)
	if err != nil {
		t.Fatal(err)
	}
	v, err = db.WorkflowView(ctx, "p")
	if err != nil || len(v.Messages) != 2 || v.Messages[0].Role != "user" {
		t.Fatalf("conversation order: %+v %v", v.Messages, err)
	}
}
func TestWorkflowDependenciesRejectCyclesAndUnknownIDs(t *testing.T) {
	_, b := workflowFixture(t)
	b.Tasks[0].DependsOn = []string{"b"}
	if ValidateBoard(b) == nil {
		t.Fatal("accepted cyclic dependencies")
	}
	b.Tasks[0].DependsOn = []string{"missing"}
	if ValidateBoard(b) == nil {
		t.Fatal("accepted unknown dependency")
	}
}

func TestNotificationRecipientAndVersionAreBound(t *testing.T) {
	db, b := workflowFixture(t)
	ctx := context.Background()
	// Exercise the same peer record the existing bridge uses; never create an external channel.
	_, err := db.sql.ExecContext(ctx, `INSERT INTO chat_peers(channel,peer_id,status,created_at,last_seen_at) VALUES('feishu','owner','paired',1,1)`)
	if err != nil {
		t.Fatal(err)
	}
	n, err := db.QueueWorkflowNotice(ctx, WorkflowNotice{ProjectID: "p", StageID: "P1", Revision: b.Rev, Channel: "feishu", PeerID: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := db.QueueWorkflowNotice(ctx, n)
	if err != nil || duplicate.ID != n.ID {
		t.Fatalf("notification duplicated: %v", err)
	}
	if err = db.DecideWorkflowNotice(ctx, n.ID, "feishu", "intruder", true); err == nil {
		t.Fatal("another recipient approved")
	}
	if err = db.DecideWorkflowNotice(ctx, n.ID, "feishu", "owner", true); err != nil {
		t.Fatal(err)
	}
	if err = db.DecideWorkflowNotice(ctx, n.ID, "feishu", "owner", true); err != nil {
		t.Fatalf("duplicate confirmation not idempotent: %v", err)
	}
	b.Goal = "new scope"
	b, err = db.SaveProjectBoard(ctx, b)
	if err != nil {
		t.Fatal(err)
	}
	n2, err := db.QueueWorkflowNotice(ctx, WorkflowNotice{ProjectID: "p", StageID: "P1", Revision: b.Rev, Channel: "feishu", PeerID: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	b.Goal = "changed again"
	if _, err = db.SaveProjectBoard(ctx, b); err != nil {
		t.Fatal(err)
	}
	if err = db.DecideWorkflowNotice(ctx, n2.ID, "feishu", "owner", true); !errors.Is(err, ErrBoardStale) {
		t.Fatalf("old plan confirmed: %v", err)
	}
}

func TestWorkflowEditedRetryRequiresNewAuthorization(t *testing.T) {
	db, b := workflowFixture(t)
	ctx := context.Background()
	before, err := db.ApproveStage(ctx, "p", "P1", "owner", b.Rev)
	if err != nil {
		t.Fatal(err)
	}
	run, _, _, _, err := db.ClaimNext(ctx, "p")
	if err != nil {
		t.Fatal(err)
	}
	run.State, run.Summary = "blocked", "Attempt budget exhausted"
	if err = db.FinishWorkflowRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	b, err = db.GetProjectBoard(ctx, "p")
	if err != nil {
		t.Fatal(err)
	}
	b.Tasks[0].Status = "ready"
	b, err = db.SaveProjectBoard(ctx, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, _, err = db.ClaimNext(ctx, "p"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("retried without new approval: %v", err)
	}
	after, err := db.ApproveStage(ctx, "p", "P1", "owner", b.Rev)
	if err != nil || after.ID == before.ID {
		t.Fatalf("reused prior attempt budget: %+v %v", after, err)
	}
	retry, _, _, _, err := db.ClaimNext(ctx, "p")
	if err != nil || retry.TaskID != "a" {
		t.Fatalf("explicit retry lost: %+v %v", retry, err)
	}
}

func TestNotificationConcurrentDecisionHasOneWinner(t *testing.T) {
	db, b := workflowFixture(t)
	ctx := context.Background()
	if _, err := db.sql.ExecContext(ctx, `INSERT INTO chat_peers(channel,peer_id,status,created_at,last_seen_at) VALUES('feishu','owner','paired',1,1)`); err != nil {
		t.Fatal(err)
	}
	n, err := db.QueueWorkflowNotice(ctx, WorkflowNotice{ProjectID: "p", StageID: "P1", Revision: b.Rev, Channel: "feishu", PeerID: "owner"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, accept := range []bool{false, true} {
		wg.Add(1)
		go func(accept bool) {
			defer wg.Done()
			results <- db.DecideWorkflowNotice(ctx, n.ID, "feishu", "owner", accept)
		}(accept)
	}
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("%d contradictory decisions succeeded", winners)
	}
	notices, err := db.WorkflowNotices(ctx, "p")
	if err != nil {
		t.Fatal(err)
	}
	v, err := db.WorkflowView(ctx, "p")
	if err != nil {
		t.Fatal(err)
	}
	if (notices[0].State == "confirmed") != (len(v.Approvals) == 1) {
		t.Fatalf("decision and authorization diverged: %+v %+v", notices, v.Approvals)
	}
}
