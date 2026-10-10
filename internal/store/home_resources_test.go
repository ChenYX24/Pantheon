package store

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/secret"
)

func TestHomeResourceSecretsReceiptsRetentionAndDelete(t *testing.T) {
	db, ctx := openTest(t), context.Background()
	box, err := secret.Open(filepath.Join(t.TempDir(), "test.key"))
	if err != nil {
		t.Fatal(err)
	}
	value, contextKey := "test-only-private-key", "resource:api:API_KEY"
	at := time.Date(2026, 10, 10, 0, 0, 0, 0, time.UTC)
	if err := db.PutResourceSecrets(ctx, "api", map[string][]byte{"API_KEY": box.Seal([]byte(value), contextKey)}, at); err != nil {
		t.Fatal(err)
	}
	metadata, err := db.ResourceSecrets(ctx)
	raw, _ := json.Marshal(metadata)
	if err != nil || len(metadata) != 1 || !metadata[0].Configured || strings.Contains(string(raw), value) {
		t.Fatalf("metadata: %s %v", raw, err)
	}
	sealed, err := db.UseResourceSecrets(ctx, "api", "session", "demo", "sid", at)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := box.Unseal(sealed["API_KEY"], contextKey)
	if err != nil || string(plain) != value || strings.Contains(string(sealed["API_KEY"]), value) {
		t.Fatal("seal round trip failed", err)
	}
	if _, err := box.Unseal(sealed["API_KEY"], "resource:other:API_KEY"); err == nil {
		t.Fatal("ciphertext moved between resources")
	}
	if _, err := db.UseResourceSecrets(ctx, "api", "invalid", "", "", at); err == nil {
		t.Fatal("invalid receipt purpose")
	}
	for n := 0; n < 55; n++ {
		if err := db.AddResourceUse(ctx, "api", "check", "", "", at.Add(time.Duration(n)*time.Second)); err != nil {
			t.Fatal(err)
		}
		if err := db.AddResourceCheck(ctx, "api", ResourceCheck{At: at.Add(time.Duration(n) * time.Second).Format(time.RFC3339Nano), OK: n%2 == 0, Summary: fmt.Sprint(n), Detail: json.RawMessage(`{"status":200}`)}); err != nil {
			t.Fatal(err)
		}
	}
	checks, err := db.ResourceChecks(ctx, "api")
	if err != nil || len(checks) != 20 || checks[0].Summary != "54" || checks[19].Summary != "35" {
		t.Fatalf("%+v %v", checks, err)
	}
	var count int
	if err := db.sql.QueryRow(`SELECT COUNT(*) FROM resource_checks`).Scan(&count); err != nil || count != 20 {
		t.Fatalf("stored %d checks: %v", count, err)
	}
	uses, err := db.ResourceUses(ctx, "api")
	if err != nil || len(uses) != 50 {
		t.Fatalf("uses %d: %v", len(uses), err)
	}
	if err := db.DeleteResourceData(ctx, "api"); err != nil {
		t.Fatal(err)
	}
	metadata, _ = db.ResourceSecrets(ctx)
	checks, _ = db.ResourceChecks(ctx, "api")
	uses, _ = db.ResourceUses(ctx, "api")
	if len(metadata) != 0 || len(checks) != 0 || len(uses) != 50 {
		t.Fatal("delete must keep receipts only")
	}
}

func TestHomeResourceMigrationReopens(t *testing.T) {
	ctx, path := context.Background(), filepath.Join(t.TempDir(), "test.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.PutResourceSecrets(ctx, "orphan", map[string][]byte{"KEY": {1, 2, 3}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secrets, err := db.ResourceSecrets(ctx)
	if err != nil || len(secrets) != 1 || secrets[0].ResourceID != "orphan" {
		t.Fatalf("%+v %v", secrets, err)
	}
}
