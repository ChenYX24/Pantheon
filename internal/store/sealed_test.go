package store

import (
	"context"
	"strings"
	"testing"
)

// A launch profile's secret variable and the webhook list are sealed in the
// database, as every other credential the panel keeps already was. The file
// alone used to hand over an API key in plain JSON.
func TestSecretsInProfilesAndWebhooksAreSealedAtRest(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	const key = "sk-ant-this-must-not-be-in-the-file"
	p := LaunchProfile{Name: "proxy", Command: []string{"claude"}, Env: []LaunchEnvVar{
		{Name: "ANTHROPIC_BASE_URL", Value: "https://gw.example"},
		{Name: "ANTHROPIC_AUTH_TOKEN", Value: key, Secret: true},
	}}
	if _, err := db.CreateLaunchProfile(ctx, "lp1", p); err != nil {
		t.Fatal(err)
	}
	var raw string
	if err := db.SQL().QueryRowContext(ctx, `SELECT env FROM launch_profiles WHERE id = 'lp1'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, key) {
		t.Errorf("the secret is in the column as typed: %s", raw)
	}
	if !strings.Contains(raw, "https://gw.example") {
		t.Errorf("a variable that is not secret was sealed too; the settings page shows it back: %s", raw)
	}
	got, err := db.GetLaunchProfile(ctx, "lp1")
	if err != nil {
		t.Fatal(err)
	}
	if v := envValue(got, "ANTHROPIC_AUTH_TOKEN"); v != key {
		t.Errorf("the launch path reads %q, want the key", v)
	}

	// Sealed under the profile and the name: copied onto another row it opens
	// as nothing, rather than as the other profile's key.
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO launch_profiles (id, name, command, env, claude_account_id, created_at, updated_at)
		SELECT 'lp2', 'copy', command, env, claude_account_id, created_at, updated_at FROM launch_profiles WHERE id = 'lp1'`); err != nil {
		t.Fatal(err)
	}
	if other, _ := db.GetLaunchProfile(ctx, "lp2"); envValue(other, "ANTHROPIC_AUTH_TOKEN") != "" {
		t.Error("a sealed value copied onto another row opened there")
	}

	hooks := `[{"url":"https://hooks.slack.example/T000/B000/secretpart"}]`
	if err := db.SetSealedSetting(ctx, "webhooks", hooks); err != nil {
		t.Fatal(err)
	}
	stored, _ := db.GetSetting(ctx, "webhooks", "")
	if strings.Contains(stored, "secretpart") {
		t.Errorf("the webhook URL is in the settings row as typed: %s", stored)
	}
	if back, _ := db.GetSealedSetting(ctx, "webhooks", ""); back != hooks {
		t.Errorf("read back %q", back)
	}
}

// What was stored before sealing existed still reads, and the pass the panel
// runs at start seals it; a second pass writes nothing.
func TestPlaintextFromBeforeIsReadAndThenSealed(t *testing.T) {
	db := openTest(t)
	ctx := context.Background()
	const key = "sk-legacy"
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO launch_profiles (id, name, command, env, claude_account_id, created_at, updated_at)
		VALUES ('old', 'old', '["claude"]', '[{"name":"ANTHROPIC_AUTH_TOKEN","value":"sk-legacy","secret":true}]', '', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	if err := db.SetSetting(ctx, "webhooks", `[{"url":"https://h.example/plain"}]`); err != nil {
		t.Fatal(err)
	}
	if got, _ := db.GetLaunchProfile(ctx, "old"); envValue(got, "ANTHROPIC_AUTH_TOKEN") != key {
		t.Fatalf("a plaintext row from before does not read: %+v", got.Env)
	}
	n, err := db.ResealPlaintext(ctx, "webhooks")
	if err != nil || n != 2 {
		t.Fatalf("reseal: %d %v, want 2 rows", n, err)
	}
	var raw string
	_ = db.SQL().QueryRowContext(ctx, `SELECT env FROM launch_profiles WHERE id = 'old'`).Scan(&raw)
	stored, _ := db.GetSetting(ctx, "webhooks", "")
	if strings.Contains(raw, key) || strings.Contains(stored, "plain") {
		t.Errorf("still plaintext after the pass: %s / %s", raw, stored)
	}
	if got, _ := db.GetLaunchProfile(ctx, "old"); envValue(got, "ANTHROPIC_AUTH_TOKEN") != key {
		t.Error("the resealed value does not read back")
	}
	if n, _ := db.ResealPlaintext(ctx, "webhooks"); n != 0 {
		t.Errorf("a second pass rewrote %d rows", n)
	}
}

func envValue(p LaunchProfile, name string) string {
	for _, v := range p.Env {
		if v.Name == name {
			return v.Value
		}
	}
	return ""
}
