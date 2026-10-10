package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/id"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/parthenon"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func (s *Server) reconcileHomeRun(ctx context.Context, run store.HomeRun, now time.Time) error {
	var result parthenon.HomeResult
	if err := readHomeJSON(filepath.Join(s.homeRunDir(run), "result.json"), &result); err == nil && result.ID == run.ID && result.ProjectID == run.ProjectID && result.TaskID == run.TaskID && result.Terminal() && result.State != "merged" {
		// Paths, base and session identity belong to the claim, never to a
		// worker-supplied receipt. Only execution evidence crosses back.
		result.Branch, result.Worktree, result.BaseCommit = run.Branch, run.Worktree, run.BaseCommit
		result.SessionID, result.StartedAt = run.SessionID, run.StartedAt
		if _, err := os.Stat(filepath.Join(s.homeRunDir(run), "stop")); err == nil {
			result.State, result.Summary = "stopped", "Stopped by the user; work is preserved."
		}
		if err := s.finishHomeRun(ctx, result); err != nil {
			return err
		}
		delete(s.homeExecution.vanished, run.ID)
		return nil
	}
	var progress parthenon.HomeResult
	if err := readHomeJSON(filepath.Join(s.homeRunDir(run), "progress.json"), &progress); err == nil && progress.ID == run.ID && progress.ProjectID == run.ProjectID && progress.TaskID == run.TaskID && progress.Active() {
		run.State, run.Attempt, run.Harness, run.Model, run.Reviewer = progress.State, progress.Attempt, progress.Harness, progress.Model, progress.Reviewer
		run.HeadCommit, run.Checks, run.Summary = progress.HeadCommit, progress.Checks, progress.Summary
		if err := s.DB.UpdateHomeRun(ctx, run); err != nil {
			return err
		}
	}
	alive := false
	if s.homeExecution.alive != nil {
		alive, _ = s.homeExecution.alive(ctx, run.SessionID)
	} else if s.Tmux != nil && run.SessionID != "" {
		info, err := s.Tmux.Get(ctx, id.TmuxName(run.SessionID))
		alive = err == nil && !info.Dead
	}
	if alive {
		delete(s.homeExecution.vanished, run.ID)
		return nil
	}
	if s.homeExecution.vanished == nil {
		s.homeExecution.vanished = map[string]time.Time{}
	}
	missing, seen := s.homeExecution.vanished[run.ID]
	if !seen {
		s.homeExecution.vanished[run.ID] = now
		return nil
	}
	if now.Sub(missing) <= 30*time.Second {
		return nil
	}
	result = parthenon.HomeResult{HomeRun: run}
	result.State, result.Summary, result.FinishedAt = "failed", "worker vanished", now.Unix()
	if _, err := os.Stat(filepath.Join(s.homeRunDir(run), "stop")); err == nil {
		result.State, result.Summary = "stopped", "Stopped; worker exited without a receipt."
	}
	if err := writeHomeJSON(filepath.Join(s.homeRunDir(run), "result.json"), result); err != nil {
		return err
	}
	return s.finishHomeRun(ctx, result)
}

func homeRunTask(detail home.Detail, taskID string) (home.Task, error) {
	for _, task := range detail.Tasks {
		if task.ID == taskID {
			return task, nil
		}
	}
	return home.Task{}, home.ErrNotFound
}

func (s *Server) homeRunDetail(ctx context.Context, run store.HomeRun) (home.Detail, home.Task, error) {
	snapshot, err := s.homeSnapshot(ctx, true)
	if err != nil {
		return home.Detail{}, home.Task{}, err
	}
	detail, ok := snapshot.Details[run.ProjectID]
	if !ok {
		return detail, home.Task{}, home.ErrNotFound
	}
	task, err := homeRunTask(detail, run.TaskID)
	return detail, task, err
}

func checksPassed(checks []store.HomeCheck) bool {
	if len(checks) == 0 {
		return false
	}
	for _, check := range checks {
		if check.ExitCode != 0 {
			return false
		}
	}
	return true
}

func (s *Server) finishHomeRun(ctx context.Context, result parthenon.HomeResult) error {
	detail, task, err := s.homeRunDetail(ctx, result.HomeRun)
	if err != nil {
		return err
	}
	status, reason := "blocked", oneHomeLine(result.Summary, 600)
	if result.State == "accepted" {
		status, reason = "awaiting_review", ""
		if detail.Project.Meta.AutoMerge && checksPassed(result.Checks) {
			if err := s.mergeHomeCheckout(ctx, detail, task, &result.HomeRun); err != nil {
				result.Warnings = append(result.Warnings, "Automatic merge deferred: "+err.Error())
				if errors.Is(err, errHomeMergeConflict) {
					status, reason = "blocked", errHomeMergeConflict.Error()
				}
			}
		}
	}
	if result.State == "merged" {
		status, reason = "done", ""
	}
	if result.State == "stopped" {
		status, reason = "planned", ""
	}
	if result.FinishedAt == 0 {
		result.FinishedAt = time.Now().Unix()
	}
	if result.FilesChanged == "" && result.HeadCommit != "" && detail.Project.PathExists {
		result.FilesChanged, _ = parthenon.HomeGit(ctx, detail.Project.Path, "diff", "--stat", result.BaseCommit+".."+result.HeadCommit)
	}
	if result.State == "rejected" && result.Reasons != "" {
		reason = oneHomeLine(result.Reasons, 600)
	}
	if _, err := s.Home.AppendHandoff(s.Cfg.CyxHome, result.ProjectID, result.TaskID, result.ID, homeHandoff(result)); err != nil {
		return err
	}
	if task.Status != status || task.BlockedReason != reason {
		if _, err := s.Home.Patch(s.Cfg.CyxHome, result.ProjectID, result.TaskID, home.PatchTask{Rev: task.Rev, Status: &status, BlockedReason: &reason}); err != nil {
			return err
		}
	}
	at := time.Unix(result.FinishedAt, 0)
	summary := fmt.Sprintf("%s: %s. %s", task.Title, result.State, oneHomeLine(result.Summary, 300))
	if _, err := s.Home.WriteExecutionReport(s.Cfg.CyxHome, result.ProjectID, home.ExecutionReport{Key: result.ID, File: at.Format("2006-01-02-15-04") + "-run-" + task.ID + ".md", Title: "任务 " + task.ID + " · " + result.State, Task: task.ID, At: at, NeedsUser: result.State != "merged", Summary: summary, Body: homeHandoff(result)}); err != nil {
		return err
	}
	if err := s.homeStageReports(ctx, result.ProjectID); err != nil {
		return err
	}
	if result.State == "merged" {
		if err := writeHomeJSON(filepath.Join(s.homeRunDir(result.HomeRun), "merge.json"), result.HomeRun); err != nil {
			return err
		}
	}
	return s.DB.UpdateHomeRun(ctx, result.HomeRun)
}

func oneHomeLine(text string, limit int) string {
	return homePromptText(strings.Join(strings.Fields(text), " "), limit)
}

func homeHandoff(result parthenon.HomeResult) string {
	var body strings.Builder
	fmt.Fprintf(&body, "# Run %s\n\n- Task: %s\n- Attempt: %d\n- State: %s\n- Executor: %s/%s\n- Reviewer: %s\n- Branch: %s\n- Commit: %s → %s\n\n## Summary\n\n%s\n\n## Files changed\n\n```text\n%s\n```\n\n## Checks\n", result.ID, result.TaskID, result.Attempt, result.State, result.Harness, result.Model, result.Reviewer, result.Branch, result.BaseCommit, result.HeadCommit, result.Summary, homePromptText(result.FilesChanged, 16<<10))
	if len(result.Checks) == 0 {
		body.WriteString("\nNo executable check.\n")
	}
	for _, check := range result.Checks {
		status := "PASS"
		if check.ExitCode != 0 {
			status = "FAIL"
		}
		fmt.Fprintf(&body, "\n- %s (exit %d): `%s`\n\n```text\n%s\n```\n", status, check.ExitCode, check.Command, check.Output)
	}
	fmt.Fprintf(&body, "\n## Reviewer reasons\n\n%s\n\n## Follow-ups\n", result.Reasons)
	for _, followup := range result.Followups {
		fmt.Fprintf(&body, "\n- create_task suggestion (requires confirmation): %s\n", followup)
	}
	body.WriteString("\n## Warnings\n")
	for _, warning := range result.Warnings {
		fmt.Fprintf(&body, "\n- %s\n", warning)
	}
	next := "Inspect the preserved worktree and checks, then replan the blocked task."
	switch result.State {
	case "accepted":
		next = "Review the handoff and merge the accepted run."
	case "merged":
		next = "Continue with the next planned task; review any suggested follow-ups."
	case "stopped":
		next = "Review the preserved work before starting a new run."
	}
	fmt.Fprintf(&body, "\n## Next step\n\n%s\n", next)
	return body.String()
}

func (s *Server) homeStageReports(ctx context.Context, project string) error {
	snapshot, err := s.homeSnapshot(ctx, true)
	if err != nil {
		return err
	}
	detail, ok := snapshot.Details[project]
	if !ok {
		return home.ErrNotFound
	}
	for _, stage := range detail.Project.Stages {
		if stage.Name == "" || stage.Total == 0 || stage.Done != stage.Total {
			continue
		}
		key := "stage-" + home.Revision([]byte(stage.Name))
		_, err := s.Home.WriteExecutionReport(s.Cfg.CyxHome, project, home.ExecutionReport{Key: key, File: key + ".md", Title: "阶段 " + stage.Name + " 完成", At: time.Now(), Summary: fmt.Sprintf("All %d tasks in stage %s are done.", stage.Total, stage.Name), Body: "Every task in this stage is done. Review the task handoffs for execution and acceptance evidence."})
		if err != nil {
			return err
		}
	}
	return nil
}

var errHomeMergeConflict = errors.New("merge conflict, replan")

func (s *Server) mergeHomeCheckout(ctx context.Context, detail home.Detail, task home.Task, run *store.HomeRun) error {
	if run.State != "accepted" {
		return errors.New("only an accepted run can be merged")
	}
	checkout := detail.Project.Path
	dirty, err := parthenon.HomeGit(ctx, checkout, "status", "--porcelain")
	if err != nil || dirty != "" {
		return errors.New("checkout has uncommitted changes or is unavailable")
	}
	if _, err := parthenon.HomeGit(ctx, checkout, "symbolic-ref", "--quiet", "HEAD"); err != nil {
		return errors.New("checkout is not on a branch")
	}
	head, err := parthenon.HomeGit(ctx, checkout, "rev-parse", "--verify", "refs/heads/"+run.Branch)
	if err != nil || run.HeadCommit == "" || head != run.HeadCommit {
		return errors.New("run branch changed after review; review it again before merging")
	}
	// This also recognizes a merge completed before the panel was interrupted
	// while writing its file receipts. Reconciliation must not merge it twice.
	if _, err := parthenon.HomeGit(ctx, checkout, "merge-base", "--is-ancestor", run.HeadCommit, "HEAD"); err != nil {
		message := "merge: " + task.ID + " " + task.Title + "\n\n" + parthenon.HomeTrailer(run.Harness, run.Model)
		if _, err := parthenon.HomeGit(ctx, checkout, "-c", "core.hooksPath=/dev/null", "merge", "--no-ff", "-m", message, "refs/heads/"+run.Branch); err != nil {
			if _, pending := parthenon.HomeGit(ctx, checkout, "rev-parse", "--verify", "MERGE_HEAD"); pending == nil {
				if _, abort := parthenon.HomeGit(context.WithoutCancel(ctx), checkout, "merge", "--abort"); abort != nil {
					return fmt.Errorf("merge failed and could not be aborted: %w", abort)
				}
				return errHomeMergeConflict
			}
			return err
		}
	}
	run.State = "merged"
	if _, err := os.Stat(run.Worktree); err == nil {
		if _, err := parthenon.HomeGit(ctx, checkout, "worktree", "remove", run.Worktree); err != nil {
			run.Summary += "\nMerged, but worktree cleanup needs attention."
		}
	}
	return nil
}

func (s *Server) handleHomeRunMerge(w http.ResponseWriter, r *http.Request) {
	s.homeExecution.mu.Lock()
	defer s.homeExecution.mu.Unlock()
	run, err := s.DB.HomeRun(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "runId"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	detail, task, err := s.homeRunDetail(r.Context(), run)
	if err != nil {
		homeError(w, err)
		return
	}
	if active, err := s.DB.ActiveHomeRuns(r.Context()); err != nil {
		s.writeStoreErr(w, err)
		return
	} else {
		for _, current := range active {
			if current.ProjectID == run.ProjectID {
				writeErr(w, 409, "project has an active run")
				return
			}
		}
	}
	if err := s.mergeHomeCheckout(r.Context(), detail, task, &run); err != nil {
		if errors.Is(err, errHomeMergeConflict) {
			status, reason := "blocked", err.Error()
			if _, patchErr := s.Home.Patch(s.Cfg.CyxHome, run.ProjectID, task.ID, home.PatchTask{Rev: task.Rev, Status: &status, BlockedReason: &reason}); patchErr != nil {
				homeError(w, patchErr)
				return
			}
		}
		writeErr(w, 409, err.Error())
		return
	}
	status, reason := "done", ""
	if _, err := s.Home.Patch(s.Cfg.CyxHome, run.ProjectID, task.ID, home.PatchTask{Rev: task.Rev, Status: &status, BlockedReason: &reason}); err != nil {
		homeError(w, err)
		return
	}
	if err := s.homeStageReports(r.Context(), run.ProjectID); err != nil {
		homeError(w, err)
		return
	}
	// Keep a file receipt for a database rebuild without overwriting the
	// independent review in result.json or the original handoff.
	if err := writeHomeJSON(filepath.Join(s.homeRunDir(run), "merge.json"), run); err != nil {
		writeErr(w, 500, "could not write merge receipt")
		return
	}
	if err := s.DB.UpdateHomeRun(r.Context(), run); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, run)
}

func (s *Server) homeExecutionPrompt(ctx context.Context, project string) string {
	runs, err := s.DB.HomeRuns(ctx, project)
	if err != nil {
		return ""
	}
	suggestions := []homeSuggestion{}
	for n, run := range runs {
		if n == 5 {
			break
		}
		var result parthenon.HomeResult
		if readHomeJSON(filepath.Join(s.homeRunDir(run), "result.json"), &result) != nil {
			continue
		}
		for _, followup := range result.Followups {
			if len(suggestions) == 20 {
				break
			}
			suggestions = append(suggestions, homeSuggestion{Type: "create_task", Task: &home.CreateTask{Title: oneHomeLine(followup, 200), Body: "Reviewer follow-up from run " + run.ID + ":\n" + homePromptText(followup, 2048)}})
		}
	}
	raw, _ := json.Marshal(suggestions)
	return "Reviewer follow-ups are unapproved create_task suggestions. Offer relevant suggestions for explicit user review; never create them automatically:\n" + string(raw)
}
