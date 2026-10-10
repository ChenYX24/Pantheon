package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/parthenon"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

type homeExecutionFixture struct {
	s       *Server
	project string
	repo    string
	starts  []tmux.CreateOptions
}

func newHomeExecutionFixture(t *testing.T) *homeExecutionFixture {
	t.Helper()
	s := newInProcessTestServer(t)
	t.Setenv("HOME", filepath.Join(s.Cfg.DataDir, "home"))
	t.Setenv("ANTHROPIC_MODEL", "")
	s.Cfg.Development = true
	s.Cfg.HomeExecute, s.Cfg.AgentScope = "allow", "off"
	project := homeFixture(t, s)
	repo := filepath.Join(s.Cfg.DataDir, "repo")
	homePut(t, filepath.Join(repo, "base.txt"), "base\n")
	local, _ := json.Marshal(map[string]any{"version": 1, "paths": map[string]string{"cyx-agent-harness": filepath.Dir(filepath.Dir(project)), "demo": repo}})
	homePut(t, filepath.Join(s.Cfg.CyxHome, "local.json"), string(local))
	f := &homeExecutionFixture{s: s, project: project, repo: repo}
	f.git(t, repo, "init", "-q", "-b", "main")
	f.git(t, repo, "config", "user.name", "Home fixture")
	f.git(t, repo, "config", "user.email", "fixture@example.invalid")
	f.git(t, repo, "add", "base.txt")
	f.git(t, repo, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "base")
	s.homeExecution.start = func(_ context.Context, options tmux.CreateOptions) error {
		f.starts = append(f.starts, options)
		return nil
	}
	s.homeExecution.alive = func(context.Context, string) (bool, error) { return true, nil }
	if err := s.DB.SetSetting(context.Background(), "home.execute.enabled", "true"); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *homeExecutionFixture) git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := parthenon.HomeGit(context.Background(), dir, args...)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func (f *homeExecutionFixture) task(t *testing.T, taskID, stage string) home.Task {
	t.Helper()
	task, err := f.s.Home.Create(f.s.Cfg.CyxHome, "demo", home.CreateTask{ID: taskID, Title: "Task " + taskID, Stage: stage, Body: "## Verify\n```sh\ntest -s proof.txt\n```\n"})
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func (f *homeExecutionFixture) run(t *testing.T, taskID string) store.HomeRun {
	t.Helper()
	return homeDecode[store.HomeRun](t, homeRequest(t, f.s, "POST", "/api/home/projects/demo/tasks/"+taskID+"/run", `{}`, true), 201)
}

func (f *homeExecutionFixture) result(t *testing.T, run store.HomeRun, state string, checked bool) parthenon.HomeResult {
	t.Helper()
	homePut(t, filepath.Join(run.Worktree, "proof.txt"), "proof\n")
	f.git(t, run.Worktree, "add", "-A")
	f.git(t, run.Worktree, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture work")
	run.HeadCommit = f.git(t, run.Worktree, "rev-parse", "HEAD")
	run.State, run.FinishedAt, run.Summary = state, time.Now().Unix(), "Implemented and checked."
	if checked {
		run.Checks = []store.HomeCheck{{Command: "test -s proof.txt", ExitCode: 0, Output: "passed"}}
	}
	result := parthenon.HomeResult{HomeRun: run, Reasons: "Reviewed independently", Followups: []string{"Future test"}, Warnings: []string{"fixture warning"}}
	if err := writeHomeJSON(filepath.Join(f.s.homeRunDir(run), "result.json"), result); err != nil {
		t.Fatal(err)
	}
	return result
}

func (f *homeExecutionFixture) detail(t *testing.T) home.Detail {
	t.Helper()
	return homeDecode[home.Detail](t, homeRequest(t, f.s, "GET", "/api/home/projects/demo", "", true), 200)
}

func TestHomeExecutionSwitchesAndAllowList(t *testing.T) {
	f := newHomeExecutionFixture(t)
	routes := map[string][]string{
		"/api/home/execution":                    {"GET", "PUT"},
		"/api/home/projects/demo/runs":           {"GET"},
		"/api/home/projects/demo/runs/run":       {"GET"},
		"/api/home/projects/demo/runs/run/stop":  {"POST"},
		"/api/home/projects/demo/runs/run/merge": {"POST"},
		"/api/home/projects/demo/tasks/T1/run":   {"POST"},
	}
	for path, methods := range routes {
		for _, method := range []string{"GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"} {
			want := false
			for _, allowed := range methods {
				want = want || allowed == method
			}
			if homePlanningRoute(method, path) != want || homePlanningRoute(method, path+"/unexpected/unexpected/unexpected") {
				t.Fatal("allow-list mismatch", method, path)
			}
			if want && homeRequest(t, f.s, method, path, `{}`, false).Code != 401 {
				t.Fatal("unauthenticated execution route", path)
			}
		}
	}
	f.task(t, "T1", "E1")
	f.s.Cfg.HomeExecute = "off"
	if w := homeRequest(t, f.s, "PUT", "/api/home/execution", `{"enabled":true}`, true); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := homeRequest(t, f.s, "POST", "/api/home/projects/demo/tasks/T1/run", `{}`, true); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	settings := homeDecode[struct {
		Flag    string `json:"flag"`
		Enabled bool   `json:"enabled"`
		MaxRuns int    `json:"maxRuns"`
	}](t, homeRequest(t, f.s, "GET", "/api/home/execution", "", true), 200)
	if settings.Flag != "off" || settings.Enabled || settings.MaxRuns != 2 {
		t.Fatal(settings)
	}
	f.s.Cfg.HomeExecute = "allow"
	if w := homeRequest(t, f.s, "PUT", "/api/home/execution", `{"enabled":false}`, true); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := homeRequest(t, f.s, "POST", "/api/home/projects/demo/tasks/T1/run", `{}`, true); w.Code != 409 {
		t.Fatal("runtime switch ignored", w.Code)
	}
	if len(f.starts) != 0 {
		t.Fatal("disabled execution started a process")
	}
}

func TestHomeExecutionClaimWorktreeSessionAndOverlay(t *testing.T) {
	f := newHomeExecutionFixture(t)
	f.task(t, "T1", "E1")
	homePut(t, filepath.Join(f.repo, "dirty.txt"), "do not carry\n")
	f.git(t, f.repo, "branch", "pantheon/T1")
	run := f.run(t, "T1")
	if run.Branch != "pantheon/T1-2" || run.SessionID == "" || !strings.Contains(run.Summary, "uncommitted") {
		t.Fatalf("%+v", run)
	}
	if _, err := os.Stat(filepath.Join(run.Worktree, "dirty.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("dirty checkout carried into worktree", err)
	}
	if len(f.starts) != 1 || f.starts[0].Dir != run.Worktree || f.starts[0].Command[1] != "home-worker" {
		t.Fatal("launch", f.starts)
	}
	var job parthenon.HomeJob
	if err := readHomeJSON(f.starts[0].Command[2], &job); err != nil || job.Run.ID != run.ID || job.Primary.Harness != "codex" || job.Secondary.Harness != "claude" || !strings.Contains(job.ActiveContext, "Ship home") {
		t.Fatal(job, err)
	}
	detail := f.detail(t)
	if detail.Tasks[0].Status != "in_progress" || detail.Tasks[0].Session != run.SessionID || detail.Project.ActiveRun == nil || detail.Project.ActiveRun.ID != run.ID || detail.Project.PanelProjectID == nil {
		t.Fatalf("%+v", detail)
	}
	row, err := f.s.DB.GetSession(context.Background(), run.SessionID)
	if err != nil || row.Title != "任务 · Task T1" || row.ProjectID != *detail.Project.PanelProjectID {
		t.Fatal(row, err)
	}
	f.task(t, "T2", "E1")
	if w := homeRequest(t, f.s, "POST", "/api/home/projects/demo/tasks/T2/run", `{}`, true); w.Code != 409 {
		t.Fatal("second writer", w.Code)
	}
}

func TestHomeExecutionSchedulerApprovalPriorityAndDependencies(t *testing.T) {
	f := newHomeExecutionFixture(t)
	first := f.task(t, "T1", "E1")
	second := f.task(t, "T2", "E1")
	f.s.homeExecutionTick(context.Background())
	if len(f.starts) != 0 {
		t.Fatal("off autonomy")
	}
	autonomy, stages := "stage", []string{"E1"}
	_, _, err := f.s.Home.PatchMeta(f.s.Cfg.CyxHome, "demo", home.PatchMeta{Autonomy: &autonomy, ApprovedStages: &stages})
	if err != nil {
		t.Fatal(err)
	}
	priority := "P0"
	deps := []string{"missing"}
	if _, err := f.s.Home.Patch(f.s.Cfg.CyxHome, "demo", first.ID, home.PatchTask{Rev: first.Rev, Priority: &priority, DependsOn: &deps}); err != nil {
		t.Fatal(err)
	}
	priority = "P1"
	if _, err := f.s.Home.Patch(f.s.Cfg.CyxHome, "demo", second.ID, home.PatchTask{Rev: second.Rev, Priority: &priority}); err != nil {
		t.Fatal(err)
	}
	f.s.homeExecutionTick(context.Background())
	runs, _ := f.s.DB.ActiveHomeRuns(context.Background())
	if len(f.starts) != 1 || len(runs) != 1 || runs[0].TaskID != "T2" {
		t.Fatal("eligibility", f.starts, runs)
	}
	detail := f.detail(t)
	stages = []string{}
	if _, _, err := f.s.Home.PatchMeta(f.s.Cfg.CyxHome, "demo", home.PatchMeta{Rev: detail.Project.MetaRev, ApprovedStages: &stages}); err != nil {
		t.Fatal(err)
	}
	f.s.homeExecutionTick(context.Background())
	if _, err := os.Stat(filepath.Join(f.s.homeRunDir(runs[0]), "stop")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("revoking a stage stopped its active worker", err)
	}
}

func TestHomeExecutionReconciliationReceiptsAndStatuses(t *testing.T) {
	for state, status := range map[string]string{"accepted": "awaiting_review", "rejected": "blocked", "blocked": "blocked", "failed": "blocked", "stopped": "planned"} {
		t.Run(state, func(t *testing.T) {
			f := newHomeExecutionFixture(t)
			f.task(t, "T1", "E1")
			run := f.run(t, "T1")
			f.result(t, run, state, true)
			f.s.Cfg.HomeExecute = "off"
			for n := 0; n < 2; n++ {
				f.s.homeExecutionTick(context.Background())
			}
			detail := f.detail(t)
			if detail.Tasks[0].Status != status || detail.Tasks[0].Handoffs != 1 || len(detail.Reports) != 1 || !detail.Reports[0].NeedsUser || detail.Project.ActiveRun != nil {
				t.Fatalf("%+v", detail)
			}
			if status == "blocked" && detail.Tasks[0].BlockedReason == "" {
				t.Fatal("missing blocked reason")
			}
			file, body, err := f.s.Home.Handoff(f.s.Cfg.CyxHome, "demo", "T1", run.ID)
			if err != nil || file != "handoff-001.md" {
				t.Fatal(file, err)
			}
			for _, text := range []string{run.ID, run.Branch, run.BaseCommit, "Attempt: 1", "PASS", "Reviewed independently", "Future test", "create_task", "fixture warning", "Next step", "proof.txt"} {
				if !strings.Contains(body, text) {
					t.Fatal("missing handoff evidence", text, body)
				}
			}
			got := homeDecode[struct {
				store.HomeRun
				Handoff string `json:"handoff"`
				Log     string `json:"log"`
			}](t, homeRequest(t, f.s, "GET", "/api/home/projects/demo/runs/"+run.ID, "", true), 200)
			if got.State != state || got.Handoff != file {
				t.Fatal(got)
			}
			if history := homeDecode[[]store.HomeRun](t, homeRequest(t, f.s, "GET", "/api/home/projects/demo/runs", "", true), 200); len(history) != 1 {
				t.Fatal(history)
			}
		})
	}
}

func TestHomeExecutionMergeSuccessAndStageSummaryOnce(t *testing.T) {
	f := newHomeExecutionFixture(t)
	f.task(t, "T1", "E1")
	run := f.run(t, "T1")
	f.result(t, run, "accepted", true)
	f.s.homeExecutionTick(context.Background())
	merged := homeDecode[store.HomeRun](t, homeRequest(t, f.s, "POST", "/api/home/projects/demo/runs/"+run.ID+"/merge", `{}`, true), 200)
	if merged.State != "merged" || f.detail(t).Tasks[0].Status != "done" {
		t.Fatal(merged)
	}
	if _, err := os.Stat(run.Worktree); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("worktree not removed", err)
	}
	f.git(t, f.repo, "show-ref", "--verify", "refs/heads/"+run.Branch)
	message := f.git(t, f.repo, "log", "-1", "--format=%B")
	if !strings.Contains(message, "merge: T1 Task T1") || !strings.Contains(message, parthenon.HomeTrailer(run.Harness, run.Model)) {
		t.Fatal(message)
	}
	for n := 0; n < 2; n++ {
		if err := f.s.homeStageReports(context.Background(), "demo"); err != nil {
			t.Fatal(err)
		}
	}
	reports := f.detail(t).Reports
	count := 0
	for _, report := range reports {
		if report.Title == "阶段 E1 完成" {
			count++
		}
	}
	if count != 1 || len(reports) != 2 {
		t.Fatal("stage summary duplication", reports)
	}
}

func TestHomeExecutionMergeRefusalsAndConflictAbort(t *testing.T) {
	for _, mode := range []string{"dirty", "detached", "conflict", "branch-changed"} {
		t.Run(mode, func(t *testing.T) {
			f := newHomeExecutionFixture(t)
			f.task(t, "T1", "E1")
			run := f.run(t, "T1")
			if mode == "conflict" {
				homePut(t, filepath.Join(run.Worktree, "base.txt"), "worker edit\n")
			}
			f.result(t, run, "accepted", true)
			f.s.homeExecutionTick(context.Background())
			switch mode {
			case "dirty":
				homePut(t, filepath.Join(f.repo, "dirty.txt"), "preserve\n")
			case "detached":
				f.git(t, f.repo, "checkout", "--detach", "HEAD")
			case "conflict":
				homePut(t, filepath.Join(f.repo, "base.txt"), "checkout edit\n")
				f.git(t, f.repo, "add", "base.txt")
				f.git(t, f.repo, "commit", "-qm", "checkout change")
			case "branch-changed":
				f.git(t, run.Worktree, "commit", "--allow-empty", "-qm", "unreviewed")
			}
			if w := homeRequest(t, f.s, "POST", "/api/home/projects/demo/runs/"+run.ID+"/merge", `{}`, true); w.Code != 409 {
				t.Fatal(w.Code, w.Body.String())
			}
			got, err := f.s.DB.HomeRun(context.Background(), "demo", run.ID)
			if err != nil || got.State != "accepted" {
				t.Fatal(got, err)
			}
			if mode == "conflict" {
				if _, err := parthenon.HomeGit(context.Background(), f.repo, "rev-parse", "--verify", "MERGE_HEAD"); err == nil {
					t.Fatal("merge not aborted")
				}
				if task := f.detail(t).Tasks[0]; task.Status != "blocked" || task.BlockedReason != "merge conflict, replan" {
					t.Fatal(task)
				}
				if f.git(t, f.repo, "status", "--porcelain") != "" {
					t.Fatal("conflict left checkout dirty")
				}
			}
		})
	}
}

func TestHomeExecutionAutoMergeRequiresExecutableChecks(t *testing.T) {
	for _, checked := range []bool{true, false} {
		t.Run(map[bool]string{true: "checked", false: "review only"}[checked], func(t *testing.T) {
			f := newHomeExecutionFixture(t)
			f.task(t, "T1", "E1")
			auto := true
			if _, _, err := f.s.Home.PatchMeta(f.s.Cfg.CyxHome, "demo", home.PatchMeta{AutoMerge: &auto}); err != nil {
				t.Fatal(err)
			}
			run := f.run(t, "T1")
			f.result(t, run, "accepted", checked)
			f.s.homeExecutionTick(context.Background())
			got, _ := f.s.DB.HomeRun(context.Background(), "demo", run.ID)
			if (got.State == "merged") != checked {
				t.Fatal(got)
			}
			for _, report := range f.detail(t).Reports {
				if report.Task == "T1" && report.NeedsUser == checked {
					t.Fatal("report needsUser", report)
				}
			}
		})
	}
}

func TestHomeExecutionVanishedProgressAndStop(t *testing.T) {
	f := newHomeExecutionFixture(t)
	f.task(t, "T1", "E1")
	run := f.run(t, "T1")
	progress := parthenon.HomeResult{HomeRun: run}
	progress.State = "reviewing"
	if err := writeHomeJSON(filepath.Join(f.s.homeRunDir(run), "progress.json"), progress); err != nil {
		t.Fatal(err)
	}
	f.s.homeExecution.alive = func(context.Context, string) (bool, error) { return false, nil }
	now := time.Now()
	for _, at := range []time.Time{now, now.Add(29 * time.Second)} {
		if err := f.s.reconcileHomeRun(context.Background(), run, at); err != nil {
			t.Fatal(err)
		}
		current, _ := f.s.DB.HomeRun(context.Background(), "demo", run.ID)
		if current.State != "reviewing" {
			t.Fatal("failed before 30 seconds or lost progress", current)
		}
	}
	if err := f.s.reconcileHomeRun(context.Background(), run, now.Add(31*time.Second)); err != nil {
		t.Fatal(err)
	}
	current, _ := f.s.DB.HomeRun(context.Background(), "demo", run.ID)
	if current.State != "failed" || current.Summary != "worker vanished" {
		t.Fatal(current)
	}
	f.task(t, "T2", "E1")
	run = f.run(t, "T2")
	if w := homeRequest(t, f.s, "POST", "/api/home/projects/demo/runs/"+run.ID+"/stop", `{}`, true); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	current, _ = f.s.DB.HomeRun(context.Background(), "demo", run.ID)
	if !current.Active() {
		t.Fatal("stop released writer before acknowledgement")
	}
	f.result(t, run, "stopped", false)
	f.s.homeExecutionTick(context.Background())
	current, _ = f.s.DB.HomeRun(context.Background(), "demo", run.ID)
	if current.State != "stopped" {
		t.Fatal(current)
	}
}

func TestHomeExecutionReplaysReceiptAfterInterruptedReconciliation(t *testing.T) {
	f := newHomeExecutionFixture(t)
	f.task(t, "T1", "E1")
	run := f.run(t, "T1")
	f.result(t, run, "accepted", true)
	f.s.homeExecutionTick(context.Background())
	before := f.detail(t)
	if err := f.s.DB.UpdateHomeRun(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	f.s.homeExecutionTick(context.Background())
	after := f.detail(t)
	if after.Tasks[0].Handoffs != 1 || len(after.Reports) != 1 || after.Tasks[0].Rev != before.Tasks[0].Rev {
		t.Fatalf("replayed files: %+v", after)
	}
	prompt := f.s.homeExecutionPrompt(context.Background(), "demo")
	if !strings.Contains(prompt, "create_task") || !strings.Contains(prompt, "Future test") || len(after.Tasks) != 1 {
		t.Fatal("follow-ups must be suggestions", prompt)
	}
}

func TestHomeExecutionRejectsMissingGitAndDependencies(t *testing.T) {
	f := newHomeExecutionFixture(t)
	task := f.task(t, "T1", "E1")
	deps := []string{"missing"}
	task, err := f.s.Home.Patch(f.s.Cfg.CyxHome, "demo", task.ID, home.PatchTask{Rev: task.Rev, DependsOn: &deps})
	if err != nil {
		t.Fatal(err)
	}
	if w := homeRequest(t, f.s, "POST", "/api/home/projects/demo/tasks/T1/run", `{}`, true); w.Code != 409 {
		t.Fatal(w.Code)
	}
	deps = []string{}
	if _, err := f.s.Home.Patch(f.s.Cfg.CyxHome, "demo", task.ID, home.PatchTask{Rev: task.Rev, DependsOn: &deps}); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(f.repo, ".git"), filepath.Join(f.repo, ".saved-git")); err != nil {
		t.Fatal(err)
	}
	if w := homeRequest(t, f.s, "POST", "/api/home/projects/demo/tasks/T1/run", `{}`, true); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(f.starts) != 0 {
		t.Fatal("ineligible task started")
	}
}
