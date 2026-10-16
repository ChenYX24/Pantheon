package store

import (
	"context"
	"testing"
)

func TestSetSettingsIsAtomic(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	if err := db.SetSettings(ctx, map[string]string{"enabled": "false", "threshold": "70"}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.sql.ExecContext(ctx, `CREATE TRIGGER refuse_threshold BEFORE UPDATE ON settings WHEN NEW.key = 'threshold' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := db.SetSettings(ctx, map[string]string{"enabled": "true", "threshold": "30"}); err == nil {
		t.Fatal("failed transaction succeeded")
	}
	for key, want := range map[string]string{"enabled": "false", "threshold": "70"} {
		if got, err := db.GetSetting(ctx, key, ""); err != nil || got != want {
			t.Fatalf("partial policy write: %s=%s, %v", key, got, err)
		}
	}
}
