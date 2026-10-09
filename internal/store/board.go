package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type ModelAssignment struct {
	Harness string `json:"harness"`
	Model   string `json:"model"`
}
type BoardStage struct {
	ID             string          `json:"id"`
	Title          string          `json:"title"`
	Primary        ModelAssignment `json:"primary"`
	Secondary      ModelAssignment `json:"secondary"`
	Reason         string          `json:"reason"`
	BudgetMinutes  int             `json:"budgetMinutes"`
	AttemptMinutes int             `json:"attemptMinutes"`
	MaxAttempts    int             `json:"maxAttempts"`
}
type BoardTask struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Status     string   `json:"status"`
	Phase      string   `json:"phase"`
	Owner      string   `json:"owner"`
	Acceptance string   `json:"acceptance"`
	Evidence   string   `json:"evidence"`
	SessionID  string   `json:"sessionId"`
	DependsOn  []string `json:"dependsOn"`
	Verify     []string `json:"verify"`
}
type ProjectBoard struct {
	ProjectID   string       `json:"projectId"`
	Goal        string       `json:"goal"`
	Stages      []BoardStage `json:"stages"`
	Tasks       []BoardTask  `json:"tasks"`
	Rev         int64        `json:"rev"`
	PlanVersion int64        `json:"planVersion"`
}

var ErrBoardStale = errors.New("board changed; reload before saving")
var ErrWorkflowBusy = errors.New("project has an active execution; pause and wait for its checkpoint before changing the plan")

func migrateProjectBoards(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE project_boards(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, content TEXT NOT NULL, rev INTEGER NOT NULL CHECK(rev>0))`)
	return err
}
func migrateWorkflow(tx *sql.Tx) error {
	for _, stmt := range []string{
		`CREATE TABLE pm_tasks(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, id TEXT NOT NULL, phase TEXT NOT NULL, position INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(project_id,id))`,
		`CREATE TABLE pm_stages(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(project_id,id))`,
		`INSERT INTO pm_tasks SELECT b.project_id, json_extract(t.value,'$.id'), COALESCE(json_extract(t.value,'$.phase'),''), t.key, t.value FROM project_boards b, json_each(b.content,'$.tasks') t`,
		`CREATE TABLE pm_approvals(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage_id TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, actor TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(project_id,stage_id,digest))`,
		`CREATE TABLE pm_runs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT NOT NULL, stage_id TEXT NOT NULL, approval_id TEXT NOT NULL REFERENCES pm_approvals(id), state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL DEFAULT 0, content TEXT NOT NULL)`,
		`CREATE UNIQUE INDEX pm_one_writer ON pm_runs(project_id) WHERE state IN ('claimed','running','stopping')`,
		`CREATE TABLE pm_events(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
		`CREATE TABLE pm_messages(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, role TEXT NOT NULL, body TEXT NOT NULL, proposal TEXT, created_at INTEGER NOT NULL)`,
		`CREATE TABLE pm_capabilities(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL)`,
		`CREATE TABLE pm_deliveries(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, event_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)`,
	} {
		if _, err := tx.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}
func ValidateBoard(b ProjectBoard) error {
	if b.Rev < 0 || len(b.Goal) > 8000 || len(b.Tasks) > 300 || len(b.Stages) > 40 {
		return errors.New("invalid revision or board too large")
	}
	stages := map[string]bool{}
	for _, s := range b.Stages {
		if strings.TrimSpace(s.ID) == "" || len(s.ID) > 100 || stages[s.ID] || len(s.Title) > 500 || len(s.Reason) > 4000 {
			return errors.New("invalid or duplicate stage")
		}
		stages[s.ID] = true
		for _, m := range []ModelAssignment{s.Primary, s.Secondary} {
			if m.Harness != "claude" && m.Harness != "codex" {
				return errors.New("executor must be claude or codex")
			}
			if strings.TrimSpace(m.Model) == "" || len(m.Model) > 200 {
				return errors.New("a concrete model is required")
			}
		}
		if s.Primary.Harness == s.Secondary.Harness {
			return errors.New("primary and secondary must use different executors")
		}
		if s.BudgetMinutes < 1 || s.BudgetMinutes > 1440 || s.AttemptMinutes < 1 || s.AttemptMinutes > s.BudgetMinutes || s.MaxAttempts < 1 || s.MaxAttempts > 3 {
			return errors.New("invalid stage budget")
		}
	}
	seen := map[string]BoardTask{}
	for _, t := range b.Tasks {
		if strings.TrimSpace(t.ID) == "" || len(t.ID) > 100 {
			return errors.New("invalid task id")
		}
		if _, ok := seen[t.ID]; ok {
			return errors.New("duplicate task id")
		}
		seen[t.ID] = t
		if strings.TrimSpace(t.Title) == "" || len(t.Title) > 500 || len(t.Phase) > 100 || len(t.Owner) > 200 || len(t.SessionID) > 100 || len(t.Acceptance) > 8000 || len(t.Evidence) > 16000 || len(t.DependsOn) > 300 || len(t.Verify) > 20 {
			return errors.New("invalid task fields")
		}
		if len(b.Stages) > 0 && !stages[t.Phase] {
			return errors.New("task references an unknown stage")
		}
		for _, v := range t.Verify {
			if strings.TrimSpace(v) == "" || len(v) > 2000 {
				return errors.New("invalid verification command")
			}
		}
		switch t.Status {
		case "planned", "ready", "running", "confirmation", "review", "done", "blocked":
		default:
			return errors.New("invalid task status")
		}
		if t.Status == "done" && (strings.TrimSpace(t.Acceptance) == "" || strings.TrimSpace(t.Evidence) == "") {
			return errors.New("completed tasks require acceptance criteria and evidence")
		}
	}
	visited := map[string]int{}
	var visit func(string) error
	visit = func(id string) error {
		if visited[id] == 1 {
			return errors.New("dependency cycle")
		}
		if visited[id] == 2 {
			return nil
		}
		t, ok := seen[id]
		if !ok {
			return errors.New("dependency references unknown task")
		}
		visited[id] = 1
		for _, dep := range t.DependsOn {
			if err := visit(dep); err != nil {
				return err
			}
		}
		visited[id] = 2
		return nil
	}
	for id := range seen {
		if err := visit(id); err != nil {
			return err
		}
	}
	return nil
}

type boardReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (d *DB) GetProjectBoard(ctx context.Context, pid string) (ProjectBoard, error) {
	tx, err := d.sql.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ProjectBoard{}, err
	}
	defer tx.Rollback()
	b, err := readProjectBoard(ctx, tx, pid)
	if err != nil {
		return b, err
	}
	return b, tx.Commit()
}

func readProjectBoard(ctx context.Context, q boardReader, pid string) (ProjectBoard, error) {
	b := ProjectBoard{ProjectID: pid, Tasks: []BoardTask{}, Stages: []BoardStage{}}
	var exists string
	if err := q.QueryRowContext(ctx, `SELECT id FROM projects WHERE id=?`, pid).Scan(&exists); err != nil {
		return b, ErrNotFound
	}
	var raw string
	err := q.QueryRowContext(ctx, `SELECT content,rev FROM project_boards WHERE project_id=?`, pid).Scan(&raw, &b.Rev)
	if errors.Is(err, sql.ErrNoRows) {
		return b, nil
	}
	if err != nil {
		return b, err
	}
	var metadata ProjectBoard
	if err = json.Unmarshal([]byte(raw), &metadata); err != nil {
		return b, err
	}
	b.Goal = metadata.Goal
	b.PlanVersion = metadata.PlanVersion
	rows, err := q.QueryContext(ctx, `SELECT content FROM pm_stages WHERE project_id=? ORDER BY position`, pid)
	if err != nil {
		return b, err
	}
	for rows.Next() {
		var v string
		var s BoardStage
		if err = rows.Scan(&v); err != nil {
			rows.Close()
			return b, err
		}
		if err = json.Unmarshal([]byte(v), &s); err != nil {
			rows.Close()
			return b, err
		}
		b.Stages = append(b.Stages, s)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return b, err
	}
	rows, err = q.QueryContext(ctx, `SELECT content FROM pm_tasks WHERE project_id=? ORDER BY position`, pid)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		var v string
		var t BoardTask
		if err = rows.Scan(&v); err != nil {
			return b, err
		}
		if err = json.Unmarshal([]byte(v), &t); err != nil {
			return b, err
		}
		if t.DependsOn == nil {
			t.DependsOn = []string{}
		}
		if t.Verify == nil {
			t.Verify = []string{}
		}
		b.Tasks = append(b.Tasks, t)
	}
	return b, rows.Err()
}
func (d *DB) SaveProjectBoard(ctx context.Context, b ProjectBoard) (ProjectBoard, error) {
	if err := ValidateBoard(b); err != nil {
		return b, err
	}
	for _, t := range b.Tasks {
		if t.SessionID != "" {
			s, err := d.GetSession(ctx, t.SessionID)
			if err != nil || s.ProjectID != b.ProjectID {
				return b, errors.New("invalid task session")
			}
		}
	}
	if _, err := d.GetProject(ctx, b.ProjectID); err != nil {
		return b, err
	}
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	b.PlanVersion = b.Rev + 1
	metadata, _ := json.Marshal(ProjectBoard{Goal: b.Goal, PlanVersion: b.PlanVersion})
	var result sql.Result
	if b.Rev == 0 {
		result, err = tx.ExecContext(ctx, `INSERT INTO project_boards(project_id,content,rev) VALUES(?,?,1) ON CONFLICT DO NOTHING`, b.ProjectID, string(metadata))
	} else {
		result, err = tx.ExecContext(ctx, `UPDATE project_boards SET content=?,rev=rev+1 WHERE project_id=? AND rev=?`, string(metadata), b.ProjectID, b.Rev)
	}
	if err != nil {
		return b, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return b, err
	}
	if n != 1 {
		return b, ErrBoardStale
	}
	var active int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM pm_runs WHERE project_id=? AND state IN ('claimed','running','stopping')`, b.ProjectID).Scan(&active); err != nil {
		return b, err
	}
	if active > 0 {
		return b, ErrWorkflowBusy
	}
	for _, table := range []string{"pm_tasks", "pm_stages"} {
		if _, err = tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE project_id=?`, b.ProjectID); err != nil {
			return b, err
		}
	}
	for i, t := range b.Tasks {
		raw, _ := json.Marshal(t)
		if _, err = tx.ExecContext(ctx, `INSERT INTO pm_tasks VALUES(?,?,?,?,?)`, b.ProjectID, t.ID, t.Phase, i, string(raw)); err != nil {
			return b, err
		}
	}
	for i, s := range b.Stages {
		raw, _ := json.Marshal(s)
		if _, err = tx.ExecContext(ctx, `INSERT INTO pm_stages VALUES(?,?,?,?)`, b.ProjectID, s.ID, i, string(raw)); err != nil {
			return b, err
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pm_approvals SET state='superseded' WHERE project_id=? AND state IN ('approved','pending','paused')`, b.ProjectID); err != nil {
		return b, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO pm_events(project_id,kind,body,created_at) VALUES(?,'plan.saved',?,?)`, b.ProjectID, fmt.Sprintf("Plan revision %d", b.Rev+1), now()); err != nil {
		return b, err
	}
	if err = tx.Commit(); err != nil {
		return b, err
	}
	b.Rev++
	if b.Stages == nil {
		b.Stages = []BoardStage{}
	}
	if b.Tasks == nil {
		b.Tasks = []BoardTask{}
	}
	return b, nil
}

// Runtime progress does not change the approved task specification.
func StageDigest(b ProjectBoard, stageID string) string {
	var stage BoardStage
	tasks := []BoardTask{}
	for _, s := range b.Stages {
		if s.ID == stageID {
			stage = s
		}
	}
	for _, t := range b.Tasks {
		if t.Phase == stageID {
			t.Status = ""
			t.Evidence = ""
			t.SessionID = ""
			tasks = append(tasks, t)
		}
	}
	raw, _ := json.Marshal(struct {
		Goal        string
		PlanVersion int64
		Stage       BoardStage
		Tasks       []BoardTask
	}{b.Goal, b.PlanVersion, stage, tasks})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
