package store

import (
	"context"
	"fmt"
)

// SetSettings commits one policy as a unit. Separate writes could leave an
// enabled policy paired with half of the previous policy's limits after a crash.
func (d *DB) SetSettings(ctx context.Context, values map[string]string) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin settings: %w", err)
	}
	defer tx.Rollback()
	for key, value := range values {
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value); err != nil {
			return fmt.Errorf("store: set setting %s: %w", key, err)
		}
	}
	return tx.Commit()
}
