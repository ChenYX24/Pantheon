package parthenon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/store"
)

type HomeJob struct {
	Run           store.HomeRun         `json:"run"`
	Task          home.Task             `json:"task"`
	Primary       store.ModelAssignment `json:"primary"`
	Secondary     store.ModelAssignment `json:"secondary"`
	Meta          home.ProjectMeta      `json:"meta"`
	AgentScope    string                `json:"agentScope"`
	ActiveContext string                `json:"activeContext"`
	Handoff       string                `json:"handoff"`
	Resources     string                `json:"resources"`
}

type HomeResult struct {
	store.HomeRun
	Reasons      string   `json:"reasons"`
	Followups    []string `json:"followups"`
	Warnings     []string `json:"warnings"`
	FilesChanged string   `json:"filesChanged"`
}

func HomeAssignments(task home.Task, catalog []HarnessModels) (store.ModelAssignment, store.ModelAssignment, error) {
	defaults := map[string]string{}
	for _, model := range catalog {
		defaults[model.Harness] = model.Default
	}
	parse := func(value, harness string) store.ModelAssignment {
		if value == "" {
			return store.ModelAssignment{Harness: harness, Model: defaults[harness]}
		}
		h, m, _ := strings.Cut(value, "/")
		return store.ModelAssignment{Harness: h, Model: m}
	}
	a, b := parse(task.Primary, "codex"), parse(task.Secondary, "claude")
	for _, model := range []store.ModelAssignment{a, b} {
		if (model.Harness != "codex" && model.Harness != "claude") || strings.TrimSpace(model.Model) == "" || len(model.Model) > 200 || strings.ContainsAny(model.Model, "\r\n") {
			return a, b, errors.New("execution requires concrete claude/codex models")
		}
	}
	if a.Harness == b.Harness || a.Model == b.Model {
		return a, b, errors.New("execution and independent review require different harnesses and models")
	}
	return a, b, nil
}

// Verification is explicitly declared in the task, never inferred from arbitrary
// code fences in prose. Each nonblank line is one command and one receipt.
func HomeVerifyCommands(body string) []string {
	commands := []string{}
	section, recording, fence := false, false, ""
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if fence != "" {
			if strings.HasPrefix(line, fence) {
				if recording {
					return commands
				}
				fence = ""
			} else if recording && line != "" {
				commands = append(commands, line)
			}
			continue
		}
		if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
			fence, recording = line[:3], section
			continue
		}
		if strings.HasPrefix(line, "## ") || strings.HasPrefix(line, "# ") {
			section = line == "## Verify" || line == "## 验收命令"
		}
	}
	return commands
}

func HomeTrailer(harness, model string) string {
	domain := "openai.com"
	if harness == "claude" {
		domain = "anthropic.com"
	}
	return fmt.Sprintf("Co-Authored-By: %s %s <noreply@%s>", harness, model, domain)
}

func HomeGit(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	var output boundedBuffer
	cmd.Stdout, cmd.Stderr = &output, &output
	cmd.WaitDelay = 5 * time.Second
	err := cmd.Run()
	if err != nil {
		return output.String(), fmt.Errorf("git %s: %w: %s", args[0], err, homeTail(output.String(), 2048))
	}
	return strings.TrimSpace(output.String()), nil
}

func homeHead(text string, limit int) string {
	if len(text) > limit {
		return text[:limit]
	}
	return text
}

func homeTail(text string, limit int) string {
	if len(text) > limit {
		return text[len(text)-limit:]
	}
	return text
}

type homeTailBuffer struct {
	mu   sync.Mutex
	text string
}

func (b *homeTailBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.text = homeTail(b.text+string(p), 2048)
	return len(p), nil
}

func homeVerifyCommand(mode, command, runtime string, uid int, lookup func(string) (string, error), stat func(string) (os.FileInfo, error)) (string, []string, []string) {
	program, args, env := agentCommand(mode, "sh", []string{"-c", command}, runtime, uid, lookup, stat)
	if len(env) > 0 {
		for n, arg := range args {
			if arg == "--nice=10" {
				args[n] = "--nice=19"
			}
		}
	}
	return program, args, env
}

func homeCheck(ctx context.Context, dir, scope, command string) store.HomeCheck {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	program, args, env := homeVerifyCommand(scope, command, os.Getenv("XDG_RUNTIME_DIR"), os.Getuid(), exec.LookPath, os.Stat)
	cmd := exec.CommandContext(ctx, program, args...)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	for _, value := range env {
		key, _, _ := strings.Cut(value, "=")
		for n := 0; n < len(cmd.Env); n++ {
			if strings.HasPrefix(cmd.Env[n], key+"=") {
				cmd.Env = append(cmd.Env[:n], cmd.Env[n+1:]...)
				n--
			}
		}
		cmd.Env = append(cmd.Env, value)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = 5 * time.Second
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	var output homeTailBuffer
	cmd.Stdout, cmd.Stderr = &output, &output
	err := cmd.Run()
	check := store.HomeCheck{Command: command, Output: output.text}
	if err != nil {
		check.ExitCode = -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			check.ExitCode = exit.ExitCode()
		}
		if check.Output == "" {
			check.Output = err.Error()
		}
	}
	return check
}

// HomeWorker has no database or Harness writer. Its immutable job and atomic
// receipts are the complete boundary with the panel, including across restart.
func HomeWorker(ctx context.Context, spec string, runner Runner) (workerErr error) {
	file, err := os.Open(spec)
	if err != nil {
		return err
	}
	var j HomeJob
	err = json.NewDecoder(io.LimitReader(file, 1<<20)).Decode(&j)
	file.Close()
	if err != nil {
		return err
	}
	if j.Run.Worktree == "" || j.Run.ID == "" || j.Task.ID != j.Run.TaskID {
		return errors.New("invalid home job")
	}
	r := HomeResult{HomeRun: j.Run, Followups: []string{}, Warnings: []string{}}
	r.State, r.Checks = "failed", []store.HomeCheck{}
	if r.Summary != "" {
		r.Warnings = append(r.Warnings, r.Summary)
	}
	dir := filepath.Dir(spec)
	ctx, cancel := context.WithCancel(WithAgentScope(ctx, j.AgentScope))
	defer cancel()
	stopped := func() bool { _, err := os.Stat(filepath.Join(dir, "stop")); return err == nil }
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if stopped() {
					cancel()
					return
				}
			}
		}
	}()
	defer func() {
		if r.Active() {
			r.State = "failed"
			r.Summary += "\nWorker interrupted before completion."
		}
		if stopped() {
			r.State, r.Summary = "stopped", "Stopped by the user; work is preserved."
		}
		r.FinishedAt = time.Now().Unix()
		if len(r.Warnings) > 0 {
			r.Summary += "\nWarnings:\n" + strings.Join(r.Warnings, "\n")
		}
		r.Summary = homeHead(r.Summary, 16000)
		data, _ := json.Marshal(r)
		if err := atomicWrite(filepath.Join(dir, "result.json"), data); err != nil {
			workerErr = err
		}
	}()
	if err := j.Meta.ValidateExecution(); err != nil {
		r.Summary = err.Error()
		return nil
	}
	if j.Primary.Harness == j.Secondary.Harness || j.Primary.Model == j.Secondary.Model || j.Primary.Model == "" || j.Secondary.Model == "" {
		r.Summary = "Independent review requires two concrete models on different harnesses."
		return nil
	}
	if runner == nil {
		runner = RunAgent
	}
	prompt := fmt.Sprintf("Task %s: %s\n%s\n\nACTIVE_CONTEXT.md:\n%s\n\nLatest task handoff:\n%s\n\n%s\n", j.Task.ID, j.Task.Title, j.Task.Body, homeHead(j.ActiveContext, 16<<10), homeHead(j.Handoff, 16<<10), j.Resources)
	prompt += "Work only in this worktree. Commit nothing: the worker commits. No push. No deploy. Stop and report if input or permission is needed. Preserve existing changes from earlier attempts. Finish with a concise summary of the changes and remaining issues."
	checkpoint := func() error {
		data, err := json.Marshal(r)
		if err == nil {
			err = atomicWrite(filepath.Join(dir, "progress.json"), data)
		}
		return err
	}
	for attempt := 1; attempt <= j.Meta.MaxAttempts; attempt++ {
		if stopped() || ctx.Err() != nil {
			return nil
		}
		executor, reviewer := j.Primary, j.Secondary
		if attempt > 1 {
			executor, reviewer = j.Secondary, j.Primary
		}
		r.Attempt, r.Harness, r.Model = attempt, executor.Harness, executor.Model
		r.Reviewer, r.State = reviewer.Harness+"/"+reviewer.Model, "running"
		if err := checkpoint(); err != nil {
			return err
		}
		fmt.Printf("Attempt %d: %s/%s\n", attempt, r.Harness, r.Model)
		turn, stop := context.WithTimeout(ctx, time.Duration(j.Meta.AttemptMinutes)*time.Minute)
		answer, err := runner(turn, executor, r.Worktree, prompt, true)
		stop()
		r.State = "failed"
		if err != nil {
			r.Summary = "Executor failed: " + err.Error()
			if errors.Is(err, ErrNeedsConfirmation) {
				r.State, r.Summary = "blocked", "Execution needs user input or permission."
				return nil
			}
			prompt += "\nPrevious executor failed; inspect preserved changes before continuing.\n"
			continue
		}
		r.Summary = homeHead(answer.Text, 12000)
		r.Checks = []store.HomeCheck{}
		passed := true
		for _, command := range HomeVerifyCommands(j.Task.Body) {
			if ctx.Err() != nil {
				return nil
			}
			check := homeCheck(ctx, r.Worktree, j.Meta.VerifyScope, command)
			r.Checks = append(r.Checks, check)
			passed = passed && check.ExitCode == 0
			fmt.Printf("Check (exit %d): %s\n%s\n", check.ExitCode, command, check.Output)
		}
		if ctx.Err() != nil {
			return nil
		}
		if _, err = homeStageChanges(ctx, r.Worktree); err == nil {
			// A no-op implementation still needs a durable commit identifying the
			// exact tree independently reviewed for this run.
			_, err = HomeGit(ctx, r.Worktree, "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", j.Task.ID+": "+j.Task.Title+"\n\n"+HomeTrailer(r.Harness, r.Model))
		}
		if err != nil {
			r.Summary = "Could not commit the execution result: " + err.Error()
			return nil
		}
		r.HeadCommit, err = HomeGit(ctx, r.Worktree, "rev-parse", "HEAD")
		if err != nil {
			r.Summary = err.Error()
			return nil
		}
		r.FilesChanged, err = HomeGit(ctx, r.Worktree, "diff", "--stat", r.BaseCommit+".."+r.HeadCommit)
		if err != nil {
			r.Summary = err.Error()
			return nil
		}
		if !passed {
			r.Summary = "Verification failed. " + r.Summary
			checks, _ := json.Marshal(r.Checks)
			prompt += "\nPrevious verification failed; fix the failures:\n" + string(checks)
			continue
		}
		diff, err := HomeGit(ctx, r.Worktree, "diff", "--no-ext-diff", r.BaseCommit+".."+r.HeadCommit)
		if err != nil {
			r.Summary = err.Error()
			return nil
		}
		if len(diff) > 200<<10 {
			r.Warnings = append(r.Warnings, "Review diff truncated to 200 KiB; inspect the worktree for the remaining changes.")
		}
		r.State = "reviewing"
		if err := checkpoint(); err != nil {
			return err
		}
		checks, _ := json.Marshal(r.Checks)
		reviewPrompt := "Independently review this task. Read-only: do not edit files or commit. Answer JSON only: {\"verdict\":\"accept|reject\",\"reasons\":\"...\",\"followups\":[\"...\"]}.\nTask: " + j.Task.Title + "\n" + j.Task.Body + "\nChecks:\n" + string(checks) + "\nDiff (base..head):\n" + homeHead(diff, 200<<10)
		reviewCtx, stop := context.WithTimeout(ctx, time.Duration(j.Meta.AttemptMinutes)*time.Minute)
		review, err := runner(reviewCtx, reviewer, r.Worktree, reviewPrompt, false)
		stop()
		r.State = "blocked"
		var verdict struct {
			Verdict   string   `json:"verdict"`
			Reasons   string   `json:"reasons"`
			Followups []string `json:"followups"`
		}
		text := strings.TrimSpace(review.Text)
		if strings.HasPrefix(text, "```") {
			_, text, _ = strings.Cut(text, "\n")
			text = strings.TrimSpace(strings.TrimSuffix(text, "```"))
		}
		if err != nil || json.Unmarshal([]byte(text), &verdict) != nil || (verdict.Verdict != "accept" && verdict.Verdict != "reject") || strings.TrimSpace(verdict.Reasons) == "" {
			r.Summary += "\nIndependent review unavailable; human review required."
			return nil
		}
		r.Reasons, r.Followups = homeHead(verdict.Reasons, 16000), verdict.Followups
		if len(r.Followups) > 50 {
			r.Followups = r.Followups[:50]
		}
		for n := range r.Followups {
			r.Followups[n] = homeHead(r.Followups[n], 2048)
		}
		r.State = "rejected"
		if verdict.Verdict == "accept" {
			r.State = "accepted"
		}
		head, headErr := HomeGit(ctx, r.Worktree, "rev-parse", "HEAD")
		dirty, dirtyErr := homeGitIgnoringArtifacts(ctx, r.Worktree, "status", "--porcelain")
		if headErr != nil || dirtyErr != nil || head != r.HeadCommit || dirty != "" {
			r.State = "blocked"
			r.Summary += "\nWorktree changed during independent review; review the new changes before acceptance."
		}
		if len(r.Checks) == 0 {
			r.Warnings = append(r.Warnings, "No executable check; acceptance relies on the reviewer and requires a manual merge.")
		}
		fmt.Printf("Task %s: %s\n%s\n", j.Task.ID, r.State, r.Reasons)
		return nil
	}
	return nil
}

// homeArtifacts are files a run produces by running code, never by intending
// to change the project: a reviewer rightly rejects a commit that carries them
// (a real run committed __pycache__ next to a one-line fix). They are excluded
// only from staging, and only while untracked; a project that tracks one of
// them keeps it.
var homeArtifacts = []string{
	"__pycache__/", "*.py[cod]", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/",
	".ipynb_checkpoints/", "node_modules/", ".DS_Store", "*.egg-info/", ".coverage", ".tox/",
}

func homeStageChanges(ctx context.Context, worktree string) (string, error) {
	return homeGitIgnoringArtifacts(ctx, worktree, "add", "-A")
}

// The review guard must see the same tree the commit saw: artifacts left by
// the verify commands are neither staged nor counted as a change.
func homeGitIgnoringArtifacts(ctx context.Context, worktree string, args ...string) (string, error) {
	f, err := os.CreateTemp("", "pantheon-exclude-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	_, err = f.WriteString(strings.Join(homeArtifacts, "\n") + "\n")
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", err
	}
	return HomeGit(ctx, worktree, append([]string{"-c", "core.excludesFile=" + f.Name()}, args...)...)
}
