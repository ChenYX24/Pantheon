package parthenon

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/store"
)

func TestWorkerFailsOverAndRequiresIndependentAcceptance(t *testing.T) {
	dir := t.TempDir()
	j := Job{Run: store.WorkflowRun{ID: "run", Workspace: dir}, Stage: store.BoardStage{Primary: store.ModelAssignment{Harness: "codex", Model: "test"}, Secondary: store.ModelAssignment{Harness: "claude", Model: "test"}, BudgetMinutes: 2, AttemptMinutes: 1, MaxAttempts: 3}, Task: store.BoardTask{ID: "task", Acceptance: "result file exists", Verify: []string{"test -f result.txt"}}, ResultPath: filepath.Join(dir, "result.json")}
	raw, _ := json.Marshal(j)
	spec := filepath.Join(dir, "job.json")
	if err := os.WriteFile(spec, raw, 0600); err != nil {
		t.Fatal(err)
	}
	writes := []string{}
	runner := func(ctx context.Context, m store.ModelAssignment, dir, prompt string, write bool) (Answer, error) {
		if write {
			writes = append(writes, m.Harness)
			if m.Harness == "codex" {
				return Answer{}, errors.New("unavailable")
			}
			if err := os.WriteFile(filepath.Join(dir, "result.txt"), []byte("ok"), 0600); err != nil {
				t.Fatal(err)
			}
			return Answer{Text: "Result created; verify result.txt"}, nil
		}
		return Answer{Text: `{"passed":true,"evidence":"result exists and acceptance check passed"}`}, nil
	}
	if err := Worker(context.Background(), spec, runner); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(j.ResultPath)
	if err != nil {
		t.Fatal(err)
	}
	var result store.WorkflowRun
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.State != "done" || result.Attempts != 2 || !result.Switched || len(writes) != 2 || writes[1] != "claude" {
		t.Fatalf("fallback: %+v %v", result, writes)
	}
	if result.CostUSD != nil {
		t.Fatal("unknown cost was reported as measured zero")
	}
}
func TestDiscussDoesNotReturnInvalidPlanAsExecutable(t *testing.T) {
	runner := func(context.Context, store.ModelAssignment, string, string, bool) (Answer, error) {
		return Answer{Text: `{"reply":"proposal","proposal":{"goal":"change","tasks":[{"id":"a","title":"x","status":"done"}]}}`}, nil
	}
	reply, err := Discuss(context.Background(), runner, store.ModelAssignment{}, t.TempDir(), "change plan", store.ProjectBoard{ProjectID: "p", Rev: 2}, store.WorkflowView{})
	if err != nil || reply.Proposal != nil {
		t.Fatalf("invalid generated plan: %+v %v", reply, err)
	}
}

func TestWorkerDoesNotFailOverToBypassUserInput(t *testing.T) {
	dir := t.TempDir()
	j := Job{Run: store.WorkflowRun{ID: "pause", Workspace: dir}, Stage: store.BoardStage{Primary: store.ModelAssignment{Harness: "codex", Model: "test"}, Secondary: store.ModelAssignment{Harness: "claude", Model: "test"}, BudgetMinutes: 1, AttemptMinutes: 1, MaxAttempts: 3}, ResultPath: filepath.Join(dir, "result.json")}
	data, _ := json.Marshal(j)
	path := filepath.Join(dir, "job.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	runner := func(context.Context, store.ModelAssignment, string, string, bool) (Answer, error) {
		calls++
		return Answer{}, ErrNeedsConfirmation
	}
	if err := Worker(context.Background(), path, runner); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("bypassed user input with %d calls", calls)
	}
	data, err := os.ReadFile(j.ResultPath)
	if err != nil {
		t.Fatal(err)
	}
	var run store.WorkflowRun
	if err = json.Unmarshal(data, &run); err != nil {
		t.Fatal(err)
	}
	if run.State != "blocked" || run.Switched {
		t.Fatalf("unexpected run: %+v", run)
	}
}

func TestRestrictedClaudeKeepsProviderConnectionWithoutHooks(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude", "settings.json"), []byte(`{"env":{"ANTHROPIC_AUTH_TOKEN":"fixture-secret","ANTHROPIC_BASE_URL":"https://fixture.invalid","UNRELATED_SETTING":"do-not-copy"},"hooks":{"PreToolUse":["do-not-run"]}}`), 0600); err != nil {
		t.Fatal(err)
	}
	env := claudeProviderEnv([]string{"PATH=/fixture", "ANTHROPIC_BASE_URL=https://explicit.invalid"})
	got := map[string]bool{}
	for _, value := range env {
		got[value] = true
	}
	if !got["ANTHROPIC_AUTH_TOKEN=fixture-secret"] || !got["ANTHROPIC_BASE_URL=https://explicit.invalid"] || len(env) != 3 {
		t.Fatal("provider settings were lost or unrelated settings imported")
	}
}

func TestRestrictedClaudeCarriesOnlyTheKeyHelper(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if got := claudeRunSettings(); got != `{"hooks":{}}` {
		t.Fatalf("without user settings: %s", got)
	}
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude", "settings.json"), []byte(`{"apiKeyHelper":"/fixture/key-helper","hooks":{"PreToolUse":["do-not-run"]},"permissions":{"allow":["Bash"]}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if got := claudeRunSettings(); got != `{"apiKeyHelper":"/fixture/key-helper","hooks":{}}` {
		t.Fatalf("restricted settings must carry the key helper and nothing else: %s", got)
	}
}

func TestMCPNamesDoNotTurnNestedCredentialsIntoServers(t *testing.T) {
	names := configuredMCPNames([]byte("[mcp_servers.first]\n[mcp_servers.first.env]\nTOKEN='private'\n[mcp_servers.\"name.with.dots\"]\n[mcp_servers.\"name.with.dots\".headers]\n"))
	if !reflect.DeepEqual(names, []string{"first", "name.with.dots"}) {
		t.Fatalf("wrong server names: %v", names)
	}
}
