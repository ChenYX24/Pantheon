package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

func migrateHomeResources(tx *sql.Tx) error {
	for _, statement := range []string{
		`CREATE TABLE resource_secrets(resource_id TEXT NOT NULL, name TEXT NOT NULL, value_enc BLOB NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(resource_id,name))`,
		`CREATE TABLE resource_uses(id INTEGER PRIMARY KEY, resource_id TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('session','check')), project_id TEXT NOT NULL, session_id TEXT NOT NULL, at TEXT NOT NULL)`,
		`CREATE INDEX resource_uses_recent ON resource_uses(resource_id,id DESC)`,
		`CREATE TABLE resource_checks(resource_id TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL, summary TEXT NOT NULL, detail_json TEXT NOT NULL)`,
		`CREATE INDEX resource_checks_recent ON resource_checks(resource_id,at DESC)`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

type ResourceSecret struct {
	ResourceID string `json:"-"`
	Name       string `json:"name"`
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt"`
}

type ResourceCheck struct {
	At      string          `json:"at"`
	OK      bool            `json:"ok"`
	Summary string          `json:"summary"`
	Detail  json.RawMessage `json:"detail"`
}

type ResourceUse struct {
	ID         int64  `json:"id"`
	ResourceID string `json:"resourceId"`
	Purpose    string `json:"purpose"`
	ProjectID  string `json:"projectId"`
	SessionID  string `json:"sessionId"`
	At         string `json:"at"`
}

func (d *DB) AddResourceUse(ctx context.Context, resource, purpose, project, session string, at time.Time) error {
	_, err := d.sql.ExecContext(ctx, `INSERT INTO resource_uses(resource_id,purpose,project_id,session_id,at) VALUES(?,?,?,?,?)`, resource, purpose, project, session, at.Format(time.RFC3339Nano))
	return err
}

func (d *DB) ResourceSecrets(ctx context.Context) ([]ResourceSecret, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT resource_id,name,updated_at FROM resource_secrets ORDER BY resource_id,name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ResourceSecret{}
	for rows.Next() {
		row := ResourceSecret{Configured: true}
		if err := rows.Scan(&row.ResourceID, &row.Name, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (d *DB) PutResourceSecrets(ctx context.Context, resource string, values map[string][]byte, at time.Time) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for name, sealed := range values {
		if _, err := tx.ExecContext(ctx, `INSERT INTO resource_secrets(resource_id,name,value_enc,updated_at) VALUES(?,?,?,?) ON CONFLICT(resource_id,name) DO UPDATE SET value_enc=excluded.value_enc,updated_at=excluded.updated_at`, resource, name, sealed, at.Format(time.RFC3339Nano)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) DeleteResourceSecret(ctx context.Context, resource, name string) error {
	_, err := d.sql.ExecContext(ctx, `DELETE FROM resource_secrets WHERE resource_id=? AND name=?`, resource, name)
	return err
}

func (d *DB) DeleteResourceData(ctx context.Context, resource string) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"resource_secrets", "resource_checks"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE resource_id=?`, resource); err != nil {
			return err
		}
	}
	// Uses survive deletion: erasing a resource must not erase its receipts.
	return tx.Commit()
}

// Reading ciphertext for use and recording the receipt are one transaction.
// Even a failed decrypt or a failed launch leaves evidence of the attempt.
func (d *DB) UseResourceSecrets(ctx context.Context, resource, purpose, project, session string, at time.Time) (map[string][]byte, error) {
	if purpose != "session" && purpose != "check" {
		return nil, errors.New("invalid resource purpose")
	}
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT name,value_enc FROM resource_secrets WHERE resource_id=? ORDER BY name`, resource)
	if err != nil {
		return nil, err
	}
	out := map[string][]byte{}
	for rows.Next() {
		var name string
		var value []byte
		if err := rows.Scan(&name, &value); err != nil {
			rows.Close()
			return nil, err
		}
		out[name] = value
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO resource_uses(resource_id,purpose,project_id,session_id,at) VALUES(?,?,?,?,?)`, resource, purpose, project, session, at.Format(time.RFC3339Nano)); err != nil {
		return nil, err
	}
	return out, tx.Commit()
}

func (d *DB) ResourceUses(ctx context.Context, resource string) ([]ResourceUse, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT id,resource_id,purpose,project_id,session_id,at FROM resource_uses WHERE resource_id=? ORDER BY id DESC LIMIT 50`, resource)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ResourceUse{}
	for rows.Next() {
		var row ResourceUse
		if err := rows.Scan(&row.ID, &row.ResourceID, &row.Purpose, &row.ProjectID, &row.SessionID, &row.At); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (d *DB) AddResourceCheck(ctx context.Context, resource string, check ResourceCheck) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO resource_checks(resource_id,at,ok,summary,detail_json) VALUES(?,?,?,?,?)`, resource, check.At, check.OK, check.Summary, string(check.Detail)); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM resource_checks WHERE resource_id=? AND rowid NOT IN (SELECT rowid FROM resource_checks WHERE resource_id=? ORDER BY at DESC,rowid DESC LIMIT 20)`, resource, resource); err != nil {
		return err
	}
	return tx.Commit()
}

func (d *DB) ResourceChecks(ctx context.Context, resource string) ([]ResourceCheck, error) {
	rows, err := d.sql.QueryContext(ctx, `SELECT at,ok,summary,detail_json FROM resource_checks WHERE resource_id=? ORDER BY at DESC,rowid DESC LIMIT 20`, resource)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ResourceCheck{}
	for rows.Next() {
		var row ResourceCheck
		var detail string
		if err := rows.Scan(&row.At, &row.OK, &row.Summary, &detail); err != nil {
			return nil, err
		}
		row.Detail = json.RawMessage(detail)
		out = append(out, row)
	}
	return out, rows.Err()
}
