package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/jiangmuran/vibepanel/internal/id"
)

func migrateHome(tx *sql.Tx) error {
	// Harness ids are not panel project ids. No foreign key here may turn
	// deleting a panel's session grouping into deleting a project's chat.
	for _, statement := range []string{
		`CREATE TABLE home_messages (
		 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
		 text TEXT NOT NULL, executor_json TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL)`,
		`CREATE INDEX home_messages_project ON home_messages(project_id, created_at DESC)`,
		`CREATE TABLE home_deliveries (
		 id INTEGER PRIMARY KEY AUTOINCREMENT, todo_id TEXT NOT NULL, project_id TEXT NOT NULL,
		 channel TEXT NOT NULL, peer TEXT NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL,
		 attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, sent_at INTEGER,
		 next_attempt_at INTEGER NOT NULL DEFAULT 0, UNIQUE(todo_id, channel, peer))`,
		`CREATE INDEX home_deliveries_pending ON home_deliveries(status, next_attempt_at)`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

type HomeMessage struct {
	ID             string           `json:"id"`
	Role           string           `json:"role"`
	Text           string           `json:"text"`
	At             string           `json:"at"`
	Executor       *ModelAssignment `json:"executor,omitempty"`
	Suggestions    json.RawMessage  `json:"suggestions,omitempty"`
	SuggestedModel json.RawMessage  `json:"suggestedModel,omitempty"`
}

type homePayload struct {
	Suggestions    json.RawMessage `json:"suggestions,omitempty"`
	SuggestedModel json.RawMessage `json:"suggestedModel,omitempty"`
}

func (d *DB) AddHomeMessage(ctx context.Context, project string, message HomeMessage) (HomeMessage, error) {
	if message.Role != "user" && message.Role != "assistant" {
		return message, errors.New("invalid home message role")
	}
	message.ID = id.New()
	at := time.Now()
	message.At = at.Format(time.RFC3339Nano)
	executor, err := json.Marshal(message.Executor)
	if err != nil {
		return message, err
	}
	payload, err := json.Marshal(homePayload{message.Suggestions, message.SuggestedModel})
	if err != nil {
		return message, err
	}
	_, err = d.sql.ExecContext(ctx, `INSERT INTO home_messages(id,project_id,role,text,executor_json,payload_json,created_at) VALUES(?,?,?,?,?,?,?)`, message.ID, project, message.Role, message.Text, string(executor), string(payload), at.UnixNano())
	return message, err
}

func (d *DB) HomeMessages(ctx context.Context, project string) ([]HomeMessage, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT id,role,text,executor_json,payload_json,created_at FROM home_messages WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HomeMessage{}
	for rows.Next() {
		var m HomeMessage
		var executor, payload string
		var at int64
		if err = rows.Scan(&m.ID, &m.Role, &m.Text, &executor, &payload, &at); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(executor), &m.Executor); err != nil {
			return nil, err
		}
		var p homePayload
		if err = json.Unmarshal([]byte(payload), &p); err != nil {
			return nil, err
		}
		m.At = time.Unix(0, at).Format(time.RFC3339Nano)
		m.Suggestions, m.SuggestedModel = p.Suggestions, p.SuggestedModel
		out = append(out, m)
	}
	slices.Reverse(out)
	return out, rows.Err()
}

type HomeDelivery struct {
	ID            int64   `json:"-"`
	TodoID        string  `json:"todoId"`
	ProjectID     string  `json:"projectId"`
	Channel       string  `json:"channel"`
	Peer          string  `json:"-"`
	Status        string  `json:"status"`
	Text          string  `json:"text"`
	Attempts      int     `json:"attempts"`
	CreatedAt     string  `json:"createdAt"`
	SentAt        *string `json:"sentAt"`
	NextAttemptAt int64   `json:"-"`
}

func (d *DB) HomeDeliveriesEmpty(ctx context.Context) (bool, error) {
	var exists bool
	err := d.sql.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM home_deliveries)`).Scan(&exists)
	return !exists, err
}

func (d *DB) RecordHomeDeliveries(ctx context.Context, deliveries []HomeDelivery) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	known := map[string]bool{}
	for _, n := range deliveries {
		exists, seen := known[n.TodoID]
		if !seen {
			if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM home_deliveries WHERE todo_id=?)`, n.TodoID).Scan(&exists); err != nil {
				return err
			}
			known[n.TodoID] = exists
		}
		// Recipients added later do not replay a baseline or an old notification.
		if exists {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, n.CreatedAt)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO home_deliveries(todo_id,project_id,channel,peer,status,text,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(todo_id,channel,peer) DO NOTHING`, n.TodoID, n.ProjectID, n.Channel, n.Peer, n.Status, n.Text, at.Unix())
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) homeDeliveries(ctx context.Context, where string, args ...any) ([]HomeDelivery, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT id,todo_id,project_id,channel,peer,status,text,attempts,created_at,sent_at,next_attempt_at FROM home_deliveries `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HomeDelivery{}
	for rows.Next() {
		var n HomeDelivery
		var created int64
		var sent sql.NullInt64
		if err = rows.Scan(&n.ID, &n.TodoID, &n.ProjectID, &n.Channel, &n.Peer, &n.Status, &n.Text, &n.Attempts, &created, &sent, &n.NextAttemptAt); err != nil {
			return nil, err
		}
		n.CreatedAt = time.Unix(created, 0).Format(time.RFC3339)
		if sent.Valid {
			at := time.Unix(sent.Int64, 0).Format(time.RFC3339)
			n.SentAt = &at
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (d *DB) HomeDeliveries(ctx context.Context) ([]HomeDelivery, error) {
	return d.homeDeliveries(ctx, `WHERE status <> 'baseline' ORDER BY id DESC LIMIT 100`)
}

func (d *DB) PendingHomeDeliveries(ctx context.Context, at int64) ([]HomeDelivery, error) {
	return d.homeDeliveries(ctx, `WHERE status='pending' AND next_attempt_at<=? ORDER BY id LIMIT 100`, at)
}

func (d *DB) UpdateHomeDelivery(ctx context.Context, n HomeDelivery) error {
	var sent any
	if n.SentAt != nil {
		at, err := time.Parse(time.RFC3339Nano, *n.SentAt)
		if err != nil {
			return err
		}
		sent = at.Unix()
	}
	return d.exec1(ctx, `UPDATE home_deliveries SET status=?,attempts=?,sent_at=?,next_attempt_at=? WHERE id=?`, n.Status, n.Attempts, sent, n.NextAttemptAt, n.ID)
}
