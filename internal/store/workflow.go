package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jiangmuran/vibepanel/internal/id"
)

type StageApproval struct {
	ID        string `json:"id"`
	StageID   string `json:"stageId"`
	Digest    string `json:"digest"`
	State     string `json:"state"`
	Actor     string `json:"actor"`
	ExpiresAt int64  `json:"expiresAt"`
}
type WorkflowRun struct {
	ID         string   `json:"id"`
	ProjectID  string   `json:"projectId"`
	TaskID     string   `json:"taskId"`
	StageID    string   `json:"stageId"`
	ApprovalID string   `json:"approvalId"`
	State      string   `json:"state"`
	SessionID  string   `json:"sessionId"`
	Workspace  string   `json:"workspace"`
	StartedAt  int64    `json:"startedAt"`
	FinishedAt int64    `json:"finishedAt"`
	Deadline   int64    `json:"deadline"`
	Summary    string   `json:"summary"`
	Attempts   int      `json:"attempts"`
	Switched   bool     `json:"switched"`
	CostUSD    *float64 `json:"costUsd"`
	CostKind   string   `json:"costKind"`
}
type WorkflowMessage struct {
	ID        string        `json:"id"`
	Role      string        `json:"role"`
	Body      string        `json:"body"`
	Proposal  *ProjectBoard `json:"proposal,omitempty"`
	CreatedAt int64         `json:"createdAt"`
}
type WorkflowEvent struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"createdAt"`
}
type Capability struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Revision  int    `json:"revision"`
	Content   string `json:"content"`
	State     string `json:"state"`
	CreatedAt int64  `json:"createdAt"`
}
type WorkflowView struct {
	Approvals    []StageApproval   `json:"approvals"`
	Runs         []WorkflowRun     `json:"runs"`
	Messages     []WorkflowMessage `json:"messages"`
	Events       []WorkflowEvent   `json:"events"`
	Capabilities []Capability      `json:"capabilities"`
}

func (d *DB) WorkflowView(ctx context.Context, pid string) (WorkflowView, error) {
	v := WorkflowView{[]StageApproval{}, []WorkflowRun{}, []WorkflowMessage{}, []WorkflowEvent{}, []Capability{}}
	if _, err := d.GetProject(ctx, pid); err != nil {
		return v, err
	}
	rows, err := d.sql.QueryContext(ctx, `SELECT id,stage_id,digest,state,actor,expires_at FROM pm_approvals WHERE project_id=? ORDER BY created_at DESC`, pid)
	if err != nil {
		return v, err
	}
	for rows.Next() {
		var a StageApproval
		if err = rows.Scan(&a.ID, &a.StageID, &a.Digest, &a.State, &a.Actor, &a.ExpiresAt); err != nil {
			rows.Close()
			return v, err
		}
		v.Approvals = append(v.Approvals, a)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return v, err
	}
	rows.Close()
	rows, err = d.sql.QueryContext(ctx, `SELECT content,state,started_at,finished_at FROM pm_runs WHERE project_id=? ORDER BY started_at DESC LIMIT 200`, pid)
	if err != nil {
		return v, err
	}
	for rows.Next() {
		var raw, state string
		var start, end int64
		var r WorkflowRun
		if err = rows.Scan(&raw, &state, &start, &end); err != nil {
			rows.Close()
			return v, err
		}
		if err = json.Unmarshal([]byte(raw), &r); err != nil {
			rows.Close()
			return v, err
		}
		r.State = state
		r.StartedAt = start
		r.FinishedAt = end
		v.Runs = append(v.Runs, r)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return v, err
	}
	rows.Close()
	rows, err = d.sql.QueryContext(ctx, `SELECT id,role,body,proposal,created_at FROM (SELECT rowid AS seq,* FROM pm_messages WHERE project_id=? ORDER BY rowid DESC LIMIT 100) ORDER BY seq`, pid)
	// Explicit ordering avoids depending on SQLite's anonymous subquery rowid.
	if err != nil {
		return v, err
	}
	for rows.Next() {
		var m WorkflowMessage
		var raw sql.NullString
		if err = rows.Scan(&m.ID, &m.Role, &m.Body, &raw, &m.CreatedAt); err != nil {
			rows.Close()
			return v, err
		}
		if raw.Valid {
			var b ProjectBoard
			if err = json.Unmarshal([]byte(raw.String), &b); err != nil {
				rows.Close()
				return v, err
			}
			m.Proposal = &b
		}
		v.Messages = append(v.Messages, m)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return v, err
	}
	rows.Close()
	rows, err = d.sql.QueryContext(ctx, `SELECT id,kind,body,created_at FROM pm_events WHERE project_id=? ORDER BY id DESC LIMIT 100`, pid)
	if err != nil {
		return v, err
	}
	for rows.Next() {
		var e WorkflowEvent
		if err = rows.Scan(&e.ID, &e.Kind, &e.Body, &e.CreatedAt); err != nil {
			rows.Close()
			return v, err
		}
		v.Events = append(v.Events, e)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return v, err
	}
	rows.Close()
	rows, err = d.sql.QueryContext(ctx, `SELECT id,name,kind,revision,content,state,created_at FROM pm_capabilities WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`, pid)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Capability
		if err = rows.Scan(&c.ID, &c.Name, &c.Kind, &c.Revision, &c.Content, &c.State, &c.CreatedAt); err != nil {
			return v, err
		}
		v.Capabilities = append(v.Capabilities, c)
	}
	return v, rows.Err()
}
func (d *DB) AddWorkflowMessage(ctx context.Context, pid, role, body string, proposal *ProjectBoard) (WorkflowMessage, error) {
	m := WorkflowMessage{ID: id.New(), Role: role, Body: body, Proposal: proposal, CreatedAt: now()}
	var raw any
	if proposal != nil {
		b, err := json.Marshal(proposal)
		if err != nil {
			return m, err
		}
		raw = string(b)
	}
	_, err := d.sql.ExecContext(ctx, `INSERT INTO pm_messages VALUES(?,?,?,?,?,?)`, m.ID, pid, role, body, raw, m.CreatedAt)
	return m, err
}
func (d *DB) WorkflowEvent(ctx context.Context, pid, kind, body string) error {
	_, err := d.sql.ExecContext(ctx, `INSERT INTO pm_events(project_id,kind,body,created_at) VALUES(?,?,?,?)`, pid, kind, body, now())
	return err
}
func (d *DB) ApproveStage(ctx context.Context, pid, stageID, actor string, rev int64) (StageApproval, error) {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return StageApproval{}, err
	}
	defer tx.Rollback()
	// Lock before reading the plan or making a decision, including IM callbacks.
	if _, err = tx.ExecContext(ctx, `UPDATE project_boards SET rev=rev WHERE project_id=?`, pid); err != nil {
		return StageApproval{}, err
	}
	a, err := approveStageTx(ctx, tx, pid, stageID, actor, rev)
	if err != nil {
		return a, err
	}
	return a, tx.Commit()
}

func approveStageTx(ctx context.Context, tx *sql.Tx, pid, stageID, actor string, rev int64) (StageApproval, error) {
	a := StageApproval{ID: id.New(), StageID: stageID, State: "approved", Actor: actor, ExpiresAt: now() + 86400}
	b, err := readProjectBoard(ctx, tx, pid)
	if err != nil {
		return a, err
	}
	if b.Rev != rev {
		return a, ErrBoardStale
	}
	found, tasks := false, 0
	for _, s := range b.Stages {
		if s.ID == stageID {
			found = true
		}
	}
	if !found {
		return a, ErrNotFound
	}
	for _, t := range b.Tasks {
		if t.Phase == stageID {
			tasks++
			if t.Acceptance == "" {
				return a, errors.New("stage tasks need acceptance criteria")
			}
		}
	}
	if tasks == 0 {
		return a, errors.New("stage has no tasks")
	}
	a.Digest = StageDigest(b, stageID)
	var old StageApproval
	err = tx.QueryRowContext(ctx, `SELECT id,state,actor,expires_at FROM pm_approvals WHERE project_id=? AND stage_id=? AND digest=?`, pid, stageID, a.Digest).Scan(&old.ID, &old.State, &old.Actor, &old.ExpiresAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return a, err
	}
	if old.ID != "" {
		a.ID = old.ID
	}
	if old.State == "approved" && old.ExpiresAt > now() {
		a.ExpiresAt, a.Actor = old.ExpiresAt, old.Actor
	} else {
		_, err = tx.ExecContext(ctx, `INSERT INTO pm_approvals VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id,stage_id,digest) DO UPDATE SET state='approved',actor=excluded.actor,expires_at=excluded.expires_at`, a.ID, pid, stageID, a.Digest, a.State, actor, a.ExpiresAt, now())
		if err != nil {
			return a, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO pm_events(project_id,kind,body,created_at) VALUES(?,'stage.approved',?,?)`, pid, fmt.Sprintf("%s approved by %s", stageID, actor), now()); err != nil {
			return a, err
		}
	}
	// All channels point at this same authorization; a delayed send cannot undo it.
	_, err = tx.ExecContext(ctx, `UPDATE pm_deliveries SET state='confirmed' WHERE project_id=? AND json_extract(content,'$.stageId')=? AND json_extract(content,'$.digest')=? AND state NOT IN ('confirmed','rejected')`, pid, stageID, a.Digest)
	return a, err
}
func (d *DB) PauseStage(ctx context.Context, pid, stageID string) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE pm_approvals SET state='paused' WHERE project_id=? AND stage_id=? AND state='approved'`, pid, stageID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pm_runs SET state='stopping' WHERE project_id=? AND stage_id=? AND state IN ('claimed','running')`, pid, stageID); err != nil {
		return err
	}
	return tx.Commit()
}

// ClaimNext takes the SQLite write lock before inspecting capacity or approval.
// The unique partial index also prevents a second panel process taking this project.
func (d *DB) ClaimNext(ctx context.Context, pid string) (WorkflowRun, ProjectBoard, BoardStage, BoardTask, error) {
	r := WorkflowRun{ID: id.New(), ProjectID: pid, State: "claimed", StartedAt: now(), CostKind: "unknown"}
	var stage BoardStage
	var task BoardTask
	b, err := d.GetProjectBoard(ctx, pid)
	if err != nil {
		return r, b, stage, task, err
	}
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return r, b, stage, task, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE project_boards SET rev=rev WHERE project_id=? AND rev=?`, pid, b.Rev)
	if err != nil {
		return r, b, stage, task, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return r, b, stage, task, ErrBoardStale
	}
	var global, project int
	if err = tx.QueryRowContext(ctx, `SELECT count(*),COALESCE(sum(project_id=?),0) FROM pm_runs WHERE state IN ('claimed','running','stopping')`, pid).Scan(&global, &project); err != nil {
		return r, b, stage, task, err
	}
	if global >= 2 || project > 0 {
		return r, b, stage, task, ErrWorkflowBusy
	}
	completed := map[string]bool{}
	for _, t := range b.Tasks {
		completed[t.ID] = t.Status == "done"
	}
	for _, s := range b.Stages {
		var a string
		err = tx.QueryRowContext(ctx, `SELECT id FROM pm_approvals WHERE project_id=? AND stage_id=? AND digest=? AND state='approved' AND expires_at>?`, pid, s.ID, StageDigest(b, s.ID), now()).Scan(&a)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return r, b, stage, task, err
		}
		var used int64
		if err = tx.QueryRowContext(ctx, `SELECT COALESCE(sum(MAX(0,finished_at-started_at)),0) FROM pm_runs WHERE approval_id=? AND finished_at>0`, a).Scan(&used); err != nil {
			return r, b, stage, task, err
		}
		if used >= int64(s.BudgetMinutes*60) {
			continue
		}
		for _, t := range b.Tasks {
			if t.Phase != s.ID || (t.Status != "planned" && t.Status != "ready") {
				continue
			}
			ready := true
			for _, dep := range t.DependsOn {
				if !completed[dep] {
					ready = false
				}
			}
			if !ready {
				continue
			}
			var previous int
			if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM pm_runs WHERE project_id=? AND task_id=? AND approval_id=?`, pid, t.ID, a).Scan(&previous); err != nil {
				return r, b, stage, task, err
			}
			if previous > 0 {
				continue
			}
			stage = s
			stage.BudgetMinutes = int((int64(s.BudgetMinutes*60) - used + 59) / 60)
			task = t
			r.TaskID = t.ID
			r.StageID = s.ID
			r.ApprovalID = a
			r.Deadline = now() + int64(s.BudgetMinutes*60) - used
			break
		}
		if r.TaskID != "" {
			break
		}
	}
	if r.TaskID == "" {
		return r, b, stage, task, ErrNotFound
	}
	raw, _ := json.Marshal(r)
	if _, err = tx.ExecContext(ctx, `INSERT INTO pm_runs(id,project_id,task_id,stage_id,approval_id,state,started_at,content) VALUES(?,?,?,?,?,?,?,?)`, r.ID, pid, r.TaskID, r.StageID, r.ApprovalID, r.State, r.StartedAt, string(raw)); err != nil {
		return r, b, stage, task, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pm_tasks SET content=json_set(content,'$.status','running') WHERE project_id=? AND id=?`, pid, r.TaskID); err != nil {
		return r, b, stage, task, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE project_boards SET rev=rev+1 WHERE project_id=?`, pid); err != nil {
		return r, b, stage, task, err
	}
	return r, b, stage, task, tx.Commit()
}
func (d *DB) UpdateWorkflowRun(ctx context.Context, r WorkflowRun) error {
	if r.State != "running" || r.FinishedAt != 0 {
		return ErrWorkflowBusy
	}
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	saved, err := lockWorkflowRun(ctx, tx, r.ID)
	if err != nil {
		return err
	}
	// A delayed progress receipt must never reopen a finished run or release a
	// pause. Session/workspace can be bound at launch, but cannot be rebound.
	if (saved.State != "claimed" && saved.State != "running") || !sameWorkflowRun(saved, r) {
		return ErrWorkflowBusy
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pm_runs SET content=?,state=? WHERE id=?`, mustJSON(r), r.State, r.ID); err != nil {
		return err
	}
	return tx.Commit()
}
func (d *DB) FinishWorkflowRun(ctx context.Context, r WorkflowRun) error {
	if r.State != "done" && r.State != "review" && r.State != "blocked" {
		return ErrWorkflowBusy
	}
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	saved, err := lockWorkflowRun(ctx, tx, r.ID)
	if err != nil {
		return err
	}
	if !sameWorkflowRun(saved, r) {
		return ErrWorkflowBusy
	}
	if saved.State != "claimed" && saved.State != "running" && saved.State != "stopping" {
		// Reconciliation may receive the same result again after reconnecting.
		// The first terminal receipt owns the task evidence and history.
		return nil
	}
	if saved.State == "stopping" {
		// PauseStage can commit after the reconciler reads its snapshot. Decide
		// against the locked database state, not that earlier in-memory state.
		r.State = "blocked"
		if !strings.HasPrefix(r.Summary, "Paused. ") {
			r.Summary = "Paused. " + r.Summary
		}
	}
	if r.FinishedAt <= 0 {
		r.FinishedAt = now()
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pm_runs SET state=?,content=?,finished_at=? WHERE id=?`, r.State, mustJSON(r), r.FinishedAt, r.ID); err != nil {
		return err
	}
	var raw string
	if err = tx.QueryRowContext(ctx, `SELECT content FROM pm_tasks WHERE project_id=? AND id=?`, r.ProjectID, r.TaskID).Scan(&raw); err != nil {
		return err
	}
	var t BoardTask
	if err = json.Unmarshal([]byte(raw), &t); err != nil {
		return err
	}
	t.Status = r.State
	if t.Status != "done" && t.Status != "review" {
		t.Status = "blocked"
	}
	t.Evidence = r.Summary
	t.SessionID = r.SessionID
	if _, err = tx.ExecContext(ctx, `UPDATE pm_tasks SET content=? WHERE project_id=? AND id=?`, mustJSON(t), r.ProjectID, r.TaskID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE project_boards SET rev=rev+1 WHERE project_id=?`, r.ProjectID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO pm_events(project_id,kind,body,created_at) VALUES(?,'task.finished',?,?)`, r.ProjectID, r.TaskID+": "+r.State+" — "+r.Summary, now()); err != nil {
		return err
	}
	return tx.Commit()
}

// Take SQLite's write lock before reading state: a deferred read followed by a
// write can fail with SQLITE_BUSY_SNAPSHOT while another connection pauses or
// completes the run. The no-op UPDATE serializes those decisions without a new
// lease system. SQL columns, not a receipt's copy, own the run's identity/state.
func lockWorkflowRun(ctx context.Context, tx *sql.Tx, runID string) (WorkflowRun, error) {
	var saved WorkflowRun
	var raw, state, project, task, stage, approval string
	var started, finished int64
	err := tx.QueryRowContext(ctx, `UPDATE pm_runs SET id=id WHERE id=? RETURNING content,state,project_id,task_id,stage_id,approval_id,started_at,finished_at`, runID).
		Scan(&raw, &state, &project, &task, &stage, &approval, &started, &finished)
	if errors.Is(err, sql.ErrNoRows) {
		return saved, ErrNotFound
	}
	if err != nil {
		return saved, err
	}
	if err = json.Unmarshal([]byte(raw), &saved); err != nil {
		return saved, err
	}
	saved.ID, saved.ProjectID, saved.TaskID = runID, project, task
	saved.StageID, saved.ApprovalID, saved.State = stage, approval, state
	saved.StartedAt, saved.FinishedAt = started, finished
	return saved, nil
}

func sameWorkflowRun(saved, receipt WorkflowRun) bool {
	return saved.ID == receipt.ID && saved.ProjectID == receipt.ProjectID &&
		saved.TaskID == receipt.TaskID && saved.StageID == receipt.StageID &&
		saved.ApprovalID == receipt.ApprovalID && saved.StartedAt == receipt.StartedAt &&
		saved.Deadline == receipt.Deadline &&
		(saved.SessionID == "" || saved.SessionID == receipt.SessionID) &&
		(saved.Workspace == "" || saved.Workspace == receipt.Workspace)
}

func (d *DB) ActiveWorkflowRuns(ctx context.Context) ([]WorkflowRun, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT content,state FROM pm_runs WHERE state IN ('claimed','running','stopping')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WorkflowRun{}
	for rows.Next() {
		var raw, state string
		var r WorkflowRun
		if err = rows.Scan(&raw, &state); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &r); err != nil {
			return nil, err
		}
		r.State = state
		out = append(out, r)
	}
	return out, rows.Err()
}
func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
func (d *DB) SaveCapability(ctx context.Context, pid string, c Capability) (Capability, error) {
	if c.Name == "" || len(c.Name) > 200 || len(c.Content) > 64000 {
		return c, errors.New("invalid capability")
	}
	switch c.Kind {
	case "skill", "rule", "mcp", "handoff", "remote":
	default:
		return c, errors.New("invalid capability kind")
	}
	if c.ID == "" {
		c.ID = id.New()
	}

	c.State = "draft"
	c.CreatedAt = time.Now().Unix()
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return c, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE projects SET last_active_at=last_active_at WHERE id=?`, pid); err != nil {
		return c, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision),0)+1 FROM pm_capabilities WHERE project_id=? AND name=? AND kind=?`, pid, c.Name, c.Kind).Scan(&c.Revision); err != nil {
		return c, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO pm_capabilities VALUES(?,?,?,?,?,?,?,?)`, c.ID, pid, c.Name, c.Kind, c.Revision, c.Content, c.State, c.CreatedAt)
	if err != nil {
		return c, err
	}
	return c, tx.Commit()

}
func (d *DB) ActivateCapability(ctx context.Context, pid, cid string, rev int) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE pm_capabilities SET state='active' WHERE project_id=? AND id=? AND revision=? AND state='draft'`, pid, cid, rev)
	if err != nil {
		return err
	}
	var active int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM pm_runs WHERE project_id=? AND state IN ('claimed','running','stopping')`, pid).Scan(&active); err != nil {
		return err
	}
	if active > 0 {
		return ErrWorkflowBusy
	}

	n, _ := result.RowsAffected()
	if n != 1 {
		return ErrBoardStale
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pm_capabilities SET state='superseded' WHERE project_id=? AND id!=? AND state='active' AND name=(SELECT name FROM pm_capabilities WHERE id=?) AND kind=(SELECT kind FROM pm_capabilities WHERE id=?)`, pid, cid, cid, cid); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pm_approvals SET state='superseded' WHERE project_id=? AND state IN ('approved','paused')`, pid); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE project_boards SET content=json_set(content,'$.planVersion',rev+1),rev=rev+1 WHERE project_id=?`, pid); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO pm_events(project_id,kind,body,created_at) VALUES(?,'capability.activated',?,?)`, pid, cid, now()); err != nil {
		return err
	}

	return tx.Commit()
}
