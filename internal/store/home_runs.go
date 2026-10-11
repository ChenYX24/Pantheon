package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

func migrateHomeRuns(tx *sql.Tx) error {
	for _, statement := range []string{
		`CREATE TABLE home_runs (
		 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
		 attempt INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','reviewing','accepted','rejected','blocked','failed','stopped','merged')),
		 harness TEXT NOT NULL, model TEXT NOT NULL, reviewer TEXT NOT NULL,
		 branch TEXT NOT NULL, worktree TEXT NOT NULL, session_id TEXT NOT NULL,
		 base_commit TEXT NOT NULL, head_commit TEXT NOT NULL,
		 started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL DEFAULT 0,
		 summary TEXT NOT NULL, checks_json TEXT NOT NULL)`,
		`CREATE UNIQUE INDEX home_runs_writer ON home_runs(project_id) WHERE state IN ('running','reviewing')`,
		`CREATE INDEX home_runs_history ON home_runs(project_id, started_at DESC)`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

type HomeCheck struct {
	Command  string `json:"command"`
	ExitCode int    `json:"exitCode"`
	Output   string `json:"output"`
}

type HomeRun struct {
	ID         string      `json:"id"`
	ProjectID  string      `json:"projectId"`
	TaskID     string      `json:"taskId"`
	Attempt    int         `json:"attempt"`
	State      string      `json:"state"`
	Harness    string      `json:"harness"`
	Model      string      `json:"model"`
	Reviewer   string      `json:"reviewer"`
	Branch     string      `json:"branch"`
	Worktree   string      `json:"worktree"`
	SessionID  string      `json:"sessionId"`
	BaseCommit string      `json:"baseCommit"`
	HeadCommit string      `json:"headCommit"`
	StartedAt  int64       `json:"startedAt"`
	FinishedAt int64       `json:"finishedAt"`
	Summary    string      `json:"summary"`
	Checks     []HomeCheck `json:"checks"`
}

func (r HomeRun) Active() bool { return r.State == "running" || r.State == "reviewing" }

func (r HomeRun) Terminal() bool {
	switch r.State {
	case "accepted", "rejected", "blocked", "failed", "stopped", "merged":
		return true
	}
	return false
}

const homeRunColumns = `id,project_id,task_id,attempt,state,harness,model,reviewer,branch,worktree,session_id,base_commit,head_commit,started_at,finished_at,summary,checks_json`

func scanHomeRun(row scanner) (HomeRun, error) {
	var r HomeRun
	var checks string
	err := row.Scan(&r.ID, &r.ProjectID, &r.TaskID, &r.Attempt, &r.State, &r.Harness, &r.Model, &r.Reviewer, &r.Branch, &r.Worktree, &r.SessionID, &r.BaseCommit, &r.HeadCommit, &r.StartedAt, &r.FinishedAt, &r.Summary, &checks)
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNotFound
	}
	if err == nil {
		err = json.Unmarshal([]byte(checks), &r.Checks)
	}
	if r.Checks == nil {
		r.Checks = []HomeCheck{}
	}
	return r, err
}

func (d *DB) HomeRun(ctx context.Context, project, run string) (HomeRun, error) {
	return scanHomeRun(d.sql.QueryRowContext(ctx, `SELECT `+homeRunColumns+` FROM home_runs WHERE project_id=? AND id=?`, project, run))
}

func (d *DB) homeRuns(ctx context.Context, where string, args ...any) ([]HomeRun, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT `+homeRunColumns+` FROM home_runs `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HomeRun{}
	for rows.Next() {
		r, err := scanHomeRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (d *DB) HomeRuns(ctx context.Context, project string) ([]HomeRun, error) {
	return d.homeRuns(ctx, `WHERE project_id=? ORDER BY started_at DESC, rowid DESC LIMIT 50`, project)
}

func (d *DB) ActiveHomeRuns(ctx context.Context) ([]HomeRun, error) {
	return d.homeRuns(ctx, `WHERE state IN ('running','reviewing') ORDER BY started_at,id`)
}

var ErrHomeRunBusy = errors.New("home execution capacity reached or project already has an active run")

func (d *DB) ClaimHomeRun(ctx context.Context, r HomeRun, limit int) error {
	if r.State != "running" || limit < 1 {
		return errors.New("invalid home run claim")
	}
	checks, err := json.Marshal(r.Checks)
	if err != nil {
		return err
	}
	// One statement arbitrates both constraints even if two callers race the
	// scheduler. Harness project ids deliberately have no panel-project FK.
	result, err := d.sql.ExecContext(ctx, `INSERT INTO home_runs (`+homeRunColumns+`)
	 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE
	 (SELECT COUNT(*) FROM home_runs WHERE state IN ('running','reviewing')) < ? AND
	 NOT EXISTS(SELECT 1 FROM home_runs WHERE project_id=? AND state IN ('running','reviewing'))`,
		r.ID, r.ProjectID, r.TaskID, r.Attempt, r.State, r.Harness, r.Model, r.Reviewer, r.Branch, r.Worktree, r.SessionID, r.BaseCommit, r.HeadCommit, r.StartedAt, r.FinishedAt, r.Summary, string(checks), limit, r.ProjectID)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrHomeRunBusy
	}
	return nil
}

func (d *DB) UpdateHomeRun(ctx context.Context, r HomeRun) error {
	if !r.Active() && !r.Terminal() {
		return errors.New("invalid home run state")
	}
	checks, err := json.Marshal(r.Checks)
	if err != nil {
		return err
	}
	return d.exec1(ctx, `UPDATE home_runs SET attempt=?,state=?,harness=?,model=?,reviewer=?,branch=?,worktree=?,session_id=?,base_commit=?,head_commit=?,finished_at=?,summary=?,checks_json=? WHERE id=? AND project_id=?`,
		r.Attempt, r.State, r.Harness, r.Model, r.Reviewer, r.Branch, r.Worktree, r.SessionID, r.BaseCommit, r.HeadCommit, r.FinishedAt, r.Summary, string(checks), r.ID, r.ProjectID)
}
