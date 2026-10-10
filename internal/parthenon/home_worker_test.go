package parthenon

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func homeWorkerFixture(t *testing.T, mode, body string) (HomeJob, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", filepath.Join(dir, "home"))
	t.Setenv("XDG_RUNTIME_DIR", filepath.Join(dir, "no-bus"))
	t.Setenv("HOME_RUN_MODE", mode)
	t.Setenv("HOME_RUN_TRACE", filepath.Join(dir, "trace"))
	t.Setenv("HOME_RUN_PROMPT", filepath.Join(dir, "prompt"))
	bin := filepath.Join(dir, "bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	fixture := `#!/usr/bin/python3
import json, os, sys, time
prompt = sys.stdin.read()
agent = os.path.basename(sys.argv[0])
review = 'Independently review' in prompt
mode = os.environ['HOME_RUN_MODE']
with open(os.environ['HOME_RUN_TRACE'], 'a') as out: out.write(agent + (' review' if review else ' write') + '\n')
with open(os.environ['HOME_RUN_PROMPT'], 'a') as out: out.write(prompt + '\n')
if not review and mode == 'permission':
    print('requires user input', file=sys.stderr)
    sys.exit(1)
if not review and mode == 'fallback' and agent == 'codex': sys.exit(75)
if not review and mode == 'stop':
    with open(os.environ['HOME_RUN_PROMPT'] + '.ready', 'w') as out: out.write('ready')
    time.sleep(60)
if not review:
    with open('proof.txt', 'w') as out: out.write('acceptance fixture\n')
answer = json.dumps({'verdict': 'reject' if mode == 'reject' else 'accept', 'reasons': 'independent evidence', 'followups': ['Add a future test']}) if review else 'Created proof.txt.'
if agent == 'codex': print(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': answer}}))
else: print(json.dumps({'result': answer, 'is_error': False}))
`
	for _, name := range []string{"claude", "codex"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(fixture), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	repo := filepath.Join(dir, "repo")
	if err := os.MkdirAll(repo, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) string {
		t.Helper()
		out, err := HomeGit(context.Background(), repo, args...)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	git("init", "-q")
	git("config", "user.name", "Home test")
	git("config", "user.email", "fixture@example.invalid")
	git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "base")
	receipt := filepath.Join(dir, "run.d")
	if err := os.MkdirAll(receipt, 0700); err != nil {
		t.Fatal(err)
	}
	meta := home.DefaultMeta()
	meta.VerifyScope = "off"
	j := HomeJob{Run: store.HomeRun{ID: "run1", ProjectID: "p", TaskID: "T1", Worktree: repo, BaseCommit: git("rev-parse", "HEAD"), Branch: "pantheon/T1", StartedAt: time.Now().Unix()}, Task: home.Task{ID: "T1", Title: "Create proof", Body: body}, Primary: store.ModelAssignment{Harness: "codex", Model: "executor-fixture"}, Secondary: store.ModelAssignment{Harness: "claude", Model: "reviewer-fixture"}, Meta: meta, AgentScope: "off", ActiveContext: "Project goal: bounded work", Handoff: "Previous shared handoff", Resources: "Allowed resource fixture; env names only"}
	spec := filepath.Join(receipt, "job.json")
	raw, _ := json.Marshal(j)
	if err := os.WriteFile(spec, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return j, spec
}

func readHomeWorkerResult(t *testing.T, spec string) HomeResult {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(spec), "result.json"))
	if err != nil {
		t.Fatal(err)
	}
	var result HomeResult
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestHomeWorkerFakeExecutables(t *testing.T) {
	for _, test := range []struct {
		mode, state, trace string
		attempt            int
	}{
		{"success", "accepted", "codex write\nclaude review\n", 1},
		{"fallback", "accepted", "codex write\nclaude write\ncodex review\n", 2},
		{"reject", "rejected", "codex write\nclaude review\n", 1},
		{"permission", "blocked", "codex write\n", 1},
	} {
		t.Run(test.mode, func(t *testing.T) {
			job, spec := homeWorkerFixture(t, test.mode, "## Verify\n```sh\ntest -s proof.txt\nprintf verified\n```\n")
			if err := HomeWorker(context.Background(), spec, nil); err != nil {
				t.Fatal(err)
			}
			result := readHomeWorkerResult(t, spec)
			trace, _ := os.ReadFile(os.Getenv("HOME_RUN_TRACE"))
			if result.State != test.state || result.Attempt != test.attempt || string(trace) != test.trace {
				t.Fatalf("%+v\ntrace %s", result, trace)
			}
			if test.mode == "permission" {
				return
			}
			if len(result.Checks) != 2 || result.Checks[1].Output != "verified" || result.HeadCommit == "" || result.HeadCommit == job.Run.BaseCommit || result.Reasons == "" || len(result.Followups) != 1 {
				t.Fatalf("receipt: %+v", result)
			}
			message, err := HomeGit(context.Background(), job.Run.Worktree, "log", "-1", "--format=%B")
			if err != nil || !strings.Contains(message, "T1: Create proof") || !strings.Contains(message, HomeTrailer(result.Harness, result.Model)) {
				t.Fatal(message, err)
			}
			prompt, _ := os.ReadFile(os.Getenv("HOME_RUN_PROMPT"))
			for _, required := range []string{"Commit nothing", "No push", "No deploy", "Previous shared handoff", "Project goal", "Allowed resource", "Diff (base..head)", "+acceptance fixture"} {
				if !strings.Contains(string(prompt), required) {
					t.Fatal("missing prompt context", required)
				}
			}
			progress, _ := os.ReadFile(filepath.Join(filepath.Dir(spec), "progress.json"))
			if !strings.Contains(string(progress), `"state":"reviewing"`) {
				t.Fatal("missing reviewing progress", string(progress))
			}
		})
	}
}

func TestHomeWorkerFailedVerificationAndNoChecks(t *testing.T) {
	_, spec := homeWorkerFixture(t, "success", "## 验收命令\n```sh\nprintf failure; exit 7\n```\n")
	if err := HomeWorker(context.Background(), spec, nil); err != nil {
		t.Fatal(err)
	}
	result := readHomeWorkerResult(t, spec)
	if result.State != "failed" || result.Attempt != 2 || len(result.Checks) != 1 || result.Checks[0].ExitCode != 7 || result.Checks[0].Output != "failure" {
		t.Fatalf("%+v", result)
	}
	trace, _ := os.ReadFile(os.Getenv("HOME_RUN_TRACE"))
	if strings.Contains(string(trace), "review") {
		t.Fatal("reviewed failed checks")
	}
	t.Run("no checks", func(t *testing.T) {
		_, spec := homeWorkerFixture(t, "success", "No executable checks yet.")
		if err := HomeWorker(context.Background(), spec, nil); err != nil {
			t.Fatal(err)
		}
		result := readHomeWorkerResult(t, spec)
		if result.State != "accepted" || len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "No executable check") {
			t.Fatalf("%+v", result)
		}
	})
}

func TestHomeWorkerStopFileCancelsAgent(t *testing.T) {
	_, spec := homeWorkerFixture(t, "stop", "")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- HomeWorker(ctx, spec, nil) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(os.Getenv("HOME_RUN_PROMPT") + ".ready"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fake agent did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(spec), "stop"), []byte("stop"), 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(9 * time.Second):
		t.Fatal("agent did not stop within 10 seconds")
	}
	if result := readHomeWorkerResult(t, spec); result.State != "stopped" {
		t.Fatalf("%+v", result)
	}
}

func TestHomeVerificationScopeAndParsing(t *testing.T) {
	lookup := func(string) (string, error) { return "/fixture/systemd-run", nil }
	stat := func(string) (os.FileInfo, error) { return nil, nil }
	program, args, env := homeVerifyCommand("auto", "make check", "/fixture/runtime", 1000, lookup, stat)
	want := []string{"--user", "--scope", "--quiet", "--collect", "-p", "MemoryMax=1200M", "-p", "CPUQuota=100%", "--nice=19", "--", "sh", "-c", "make check"}
	if program != "/fixture/systemd-run" || !reflect.DeepEqual(args, want) || len(env) != 2 {
		t.Fatal(program, args, env)
	}
	program, args, env = homeVerifyCommand("auto", "true", "/no-bus", 1000, lookup, func(string) (os.FileInfo, error) { return nil, os.ErrNotExist })
	if program != "sh" || !reflect.DeepEqual(args, []string{"-c", "true"}) || len(env) != 0 {
		t.Fatal("direct fallback", program, args, env)
	}
	body := "## Example\n```sh\nnot-a-check\n```\n## Verify\nSome text\n```sh\nfirst\n\nsecond\n```\n```sh\nignored\n```"
	if got := HomeVerifyCommands(body); !reflect.DeepEqual(got, []string{"first", "second"}) {
		t.Fatal(got)
	}
	check := homeCheck(context.Background(), t.TempDir(), "off", "printf '%03000dTAIL' 0")
	if check.ExitCode != 0 || len(check.Output) != 2048 || !strings.HasSuffix(check.Output, "TAIL") {
		t.Fatal("check must preserve last 2 KiB", check.ExitCode, len(check.Output))
	}
}

func TestHomeWorkerAssignmentsAndFenceBoundaries(t *testing.T) {
	catalog := []HarnessModels{{Harness: "codex", Default: "codex-default"}, {Harness: "claude", Default: "claude-default"}}
	a, b, err := HomeAssignments(home.Task{}, catalog)
	if err != nil || a.Model != "codex-default" || b.Model != "claude-default" {
		t.Fatal(a, b, err)
	}
	for _, task := range []home.Task{{Primary: "codex/same", Secondary: "claude/same"}, {Primary: "claude/a", Secondary: "claude/b"}, {Primary: "other/model"}} {
		if _, _, err := HomeAssignments(task, catalog); err == nil {
			t.Fatal("invalid independent pair", task)
		}
	}
	body := "```markdown\n## Verify\n```\nnot a command\n## Verify\n```sh\nreal-check\n```"
	if got := HomeVerifyCommands(body); !reflect.DeepEqual(got, []string{"real-check"}) {
		t.Fatal(got)
	}
}
