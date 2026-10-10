package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/jiangmuran/vibepanel/internal/id"
)

func migrateHomeThreads(tx *sql.Tx) error {
	for _, statement := range []string{
		`ALTER TABLE home_messages ADD COLUMN thread_id TEXT NOT NULL DEFAULT 'main'`,
		`ALTER TABLE home_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'done' CHECK(status IN ('pending','done','failed'))`,
		`ALTER TABLE home_messages ADD COLUMN error TEXT`,
		`CREATE TABLE home_threads (id TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(project_id,id))`,
		`INSERT INTO home_threads(id,project_id,title,created_at,updated_at) SELECT 'main',project_id,'主对话',MIN(created_at),MAX(created_at) FROM home_messages GROUP BY project_id`,
		`CREATE INDEX home_messages_thread ON home_messages(project_id,thread_id,created_at DESC)`,
		`CREATE UNIQUE INDEX home_messages_pending_project ON home_messages(project_id) WHERE status='pending'`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

var ErrHomePending = errors.New("a discussion is already pending for this project")
var ErrHomeTurn = errors.New("only a failed assistant turn can be retried")
var ErrHomeMain = errors.New("the main thread cannot be deleted")

type HomeThread struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	UpdatedAt    string `json:"updatedAt"`
	MessageCount int    `json:"messageCount"`
}

func ensureHomeMain(ctx context.Context, tx *sql.Tx, project string) error {
	now := time.Now().UnixNano()
	// Take the write lock before inspecting pending rows; two deferred SQLite
	// transactions cannot both upgrade the same read snapshot to a writer.
	_, err := tx.ExecContext(ctx, `INSERT INTO home_threads(id,project_id,title,created_at,updated_at) VALUES('main',?,'主对话',?,?) ON CONFLICT(project_id,id) DO NOTHING`, project, now, now)
	return err
}

func (d *DB) homeThreadTx(ctx context.Context, project, thread string) (*sql.Tx, error) {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if err = ensureHomeMain(ctx, tx, project); err == nil {
		var exists bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM home_threads WHERE project_id=? AND id=?)`, project, thread).Scan(&exists)
		if err == nil && !exists {
			err = ErrNotFound
		}
	}
	if err != nil {
		tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func (d *DB) HomeThreads(ctx context.Context, project string) ([]HomeThread, error) {
	tx, err := d.homeThreadTx(ctx, project, "main")
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	rows, err := d.sql.QueryContext(ctx, `SELECT t.id,t.title,t.updated_at,(SELECT COUNT(*) FROM home_messages m WHERE m.project_id=t.project_id AND m.thread_id=t.id) FROM home_threads t WHERE t.project_id=? ORDER BY t.updated_at DESC,t.id`, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HomeThread{}
	for rows.Next() {
		var t HomeThread
		var at int64
		if err = rows.Scan(&t.ID, &t.Title, &at, &t.MessageCount); err != nil {
			return nil, err
		}
		t.UpdatedAt = time.Unix(0, at).Format(time.RFC3339Nano)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (d *DB) CreateHomeThread(ctx context.Context, project, title string) (HomeThread, error) {
	now := time.Now()
	if strings.TrimSpace(title) == "" {
		title = "新对话 " + now.Format("15:04")
	}
	thread := HomeThread{ID: id.New(), Title: title, UpdatedAt: now.Format(time.RFC3339Nano)}
	_, err := d.sql.ExecContext(ctx, `INSERT INTO home_threads(id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?)`, thread.ID, project, title, now.UnixNano(), now.UnixNano())
	return thread, err
}

func (d *DB) RenameHomeThread(ctx context.Context, project, thread, title string) error {
	tx, err := d.homeThreadTx(ctx, project, thread)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE home_threads SET title=?,updated_at=? WHERE project_id=? AND id=?`, title, time.Now().UnixNano(), project, thread); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) DeleteHomeThread(ctx context.Context, project, thread string) error {
	if thread == "main" {
		return ErrHomeMain
	}
	tx, err := d.homeThreadTx(ctx, project, thread)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM home_messages WHERE project_id=? AND thread_id=?`, project, thread); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM home_threads WHERE project_id=? AND id=?`, project, thread); err != nil {
		return err
	}
	return tx.Commit()
}

func insertHomeMessage(ctx context.Context, tx *sql.Tx, project string, message HomeMessage) (HomeMessage, error) {
	if message.Role != "user" && message.Role != "assistant" {
		return message, errors.New("invalid home message role")
	}
	if message.ThreadID == "" {
		message.ThreadID = "main"
	}
	if message.Status == "" {
		message.Status = "done"
	}
	message.ID = id.New()
	now := time.Now()
	message.At = now.Format(time.RFC3339Nano)
	executor, err := json.Marshal(message.Executor)
	if err != nil {
		return message, err
	}
	payload, err := json.Marshal(homePayload{message.Suggestions, message.SuggestedModel})
	if err != nil {
		return message, err
	}
	if message.Role == "user" {
		var count int
		var title string
		if err = tx.QueryRowContext(ctx, `SELECT title,(SELECT COUNT(*) FROM home_messages WHERE project_id=? AND thread_id=? AND role='user') FROM home_threads WHERE project_id=? AND id=?`, project, message.ThreadID, project, message.ThreadID).Scan(&title, &count); err != nil {
			return message, err
		}
		if count == 0 && (title == "主对话" || defaultHomeTitle(title)) {
			text := []rune(strings.TrimSpace(message.Text))
			if len(text) > 30 {
				text = text[:30]
			}
			if _, err = tx.ExecContext(ctx, `UPDATE home_threads SET title=? WHERE project_id=? AND id=?`, string(text), project, message.ThreadID); err != nil {
				return message, err
			}
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO home_messages(id,project_id,role,text,executor_json,payload_json,created_at,thread_id,status,error) VALUES(?,?,?,?,?,?,?,?,?,?)`, message.ID, project, message.Role, message.Text, string(executor), string(payload), now.UnixNano(), message.ThreadID, message.Status, message.Error)
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE home_threads SET updated_at=? WHERE project_id=? AND id=?`, now.UnixNano(), project, message.ThreadID)
	}
	return message, err
}

func defaultHomeTitle(title string) bool {
	if !strings.HasPrefix(title, "新对话 ") {
		return false
	}
	_, err := time.Parse("15:04", strings.TrimPrefix(title, "新对话 "))
	return err == nil
}

func (d *DB) AddHomeMessage(ctx context.Context, project string, message HomeMessage) (HomeMessage, error) {
	if message.ThreadID == "" {
		message.ThreadID = "main"
	}
	tx, err := d.homeThreadTx(ctx, project, message.ThreadID)
	if err != nil {
		return message, err
	}
	defer tx.Rollback()
	message, err = insertHomeMessage(ctx, tx, project, message)
	if err != nil {
		return message, err
	}
	return message, tx.Commit()
}

const homeMessageColumns = `id,role,text,executor_json,payload_json,created_at,thread_id,status,error`

func scanHomeMessage(row scanner) (HomeMessage, error) {
	var m HomeMessage
	var executor, payload string
	var at int64
	if err := row.Scan(&m.ID, &m.Role, &m.Text, &executor, &payload, &at, &m.ThreadID, &m.Status, &m.Error); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			err = ErrNotFound
		}
		return m, err
	}
	if err := json.Unmarshal([]byte(executor), &m.Executor); err != nil {
		return m, err
	}
	var p homePayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return m, err
	}
	m.At = time.Unix(0, at).Format(time.RFC3339Nano)
	m.Suggestions, m.SuggestedModel = p.Suggestions, p.SuggestedModel
	return m, nil
}

func (d *DB) HomeMessages(ctx context.Context, project string, thread ...string) ([]HomeMessage, error) {
	tid := "main"
	if len(thread) > 0 && thread[0] != "" {
		tid = thread[0]
	}
	tx, err := d.homeThreadTx(ctx, project, tid)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	rows, err := d.sql.QueryContext(ctx, `SELECT `+homeMessageColumns+` FROM home_messages WHERE project_id=? AND thread_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200`, project, tid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HomeMessage{}
	for rows.Next() {
		m, err := scanHomeMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	slices.Reverse(out)
	return out, rows.Err()
}

func homePending(ctx context.Context, tx *sql.Tx, project string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM home_messages WHERE project_id=? AND status='pending')`, project).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return ErrHomePending
	}
	return nil
}

func (d *DB) BeginHomeDiscussion(ctx context.Context, project, thread, text string, executor ModelAssignment) (HomeMessage, HomeMessage, error) {
	var user, assistant HomeMessage
	if thread == "" {
		thread = "main"
	}
	tx, err := d.homeThreadTx(ctx, project, thread)
	if err != nil {
		return user, assistant, err
	}
	defer tx.Rollback()
	if err = homePending(ctx, tx, project); err != nil {
		return user, assistant, err
	}
	user, err = insertHomeMessage(ctx, tx, project, HomeMessage{ThreadID: thread, Role: "user", Text: text, Executor: &executor})
	if err != nil {
		return user, assistant, err
	}
	assistant, err = insertHomeMessage(ctx, tx, project, HomeMessage{ThreadID: thread, Role: "assistant", Status: "pending", Executor: &executor})
	if err != nil {
		return user, assistant, err
	}
	return user, assistant, tx.Commit()
}

func (d *DB) RetryHomeDiscussion(ctx context.Context, project, messageID string) (HomeMessage, HomeMessage, error) {
	var user, assistant HomeMessage
	tx, err := d.homeThreadTx(ctx, project, "main")
	if err != nil {
		return user, assistant, err
	}
	defer tx.Rollback()
	if err = homePending(ctx, tx, project); err != nil {
		return user, assistant, err
	}
	assistant, err = scanHomeMessage(tx.QueryRowContext(ctx, `SELECT `+homeMessageColumns+` FROM home_messages WHERE project_id=? AND id=?`, project, messageID))
	if err != nil {
		return user, assistant, err
	}
	if assistant.Role != "assistant" || assistant.Status != "failed" || assistant.Executor == nil {
		return user, assistant, ErrHomeTurn
	}
	at, _ := time.Parse(time.RFC3339Nano, assistant.At)
	user, err = scanHomeMessage(tx.QueryRowContext(ctx, `SELECT `+homeMessageColumns+` FROM home_messages WHERE project_id=? AND thread_id=? AND role='user' AND created_at<=? ORDER BY created_at DESC,rowid DESC LIMIT 1`, project, assistant.ThreadID, at.UnixNano()))
	if err != nil {
		return user, assistant, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE home_messages SET status='pending',error=NULL,text='',payload_json='{}' WHERE project_id=? AND id=?`, project, messageID); err != nil {
		return user, assistant, err
	}
	assistant.Status, assistant.Error, assistant.Text = "pending", nil, ""
	assistant.Suggestions, assistant.SuggestedModel = nil, nil
	return user, assistant, tx.Commit()
}

func (d *DB) CompleteHomeDiscussion(ctx context.Context, project string, message HomeMessage) error {
	if message.Status != "done" && message.Status != "failed" {
		return ErrHomeTurn
	}
	payload, err := json.Marshal(homePayload{message.Suggestions, message.SuggestedModel})
	if err != nil {
		return err
	}
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE home_messages SET status=?,error=?,text=?,payload_json=? WHERE project_id=? AND id=? AND status='pending'`, message.Status, message.Error, message.Text, string(payload), project, message.ID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return ErrNotFound
	}
	if _, err = tx.ExecContext(ctx, `UPDATE home_threads SET updated_at=? WHERE project_id=? AND id=?`, time.Now().UnixNano(), project, message.ThreadID); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) FailStaleHomeMessages(ctx context.Context, at time.Time) error {
	_, err := d.sql.ExecContext(ctx, `UPDATE home_messages SET status='failed',error='interrupted by restart' WHERE status='pending' AND created_at<?`, at.Add(-10*time.Minute).UnixNano())
	return err
}
