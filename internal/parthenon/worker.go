package parthenon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jiangmuran/vibepanel/internal/store"
)

type Job struct {
	Run          store.WorkflowRun   `json:"run"`
	Stage        store.BoardStage    `json:"stage"`
	Task         store.BoardTask     `json:"task"`
	Goal         string              `json:"goal"`
	Capabilities []store.Capability  `json:"capabilities"`
	Board        *store.ProjectBoard `json:"board,omitempty"`
	ResultPath   string              `json:"resultPath"`
}

// Worker runs as a tmux child. Its receipt outlives a panel restart.
func Worker(ctx context.Context, spec string, runner Runner) (workerErr error) {
	raw, err := os.ReadFile(spec)
	if err != nil {
		return err
	}
	var j Job
	if err = json.Unmarshal(raw, &j); err != nil {
		return err
	}
	if runner == nil {
		runner = RunAgent
	}
	if j.Run.Workspace == "" || j.ResultPath == "" {
		return errors.New("invalid job paths")
	}
	r := j.Run
	r.State = "blocked"
	start := time.Now()
	deadline := time.Now().Add(time.Duration(j.Stage.BudgetMinutes) * time.Minute)
	if j.Run.Deadline > 0 {
		deadline = time.Unix(j.Run.Deadline, 0)
	}
	ctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()

	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := os.Stat(filepath.Join(filepath.Dir(spec), "stop")); err == nil {
					cancel()
					return
				}
			}
		}
	}()
	defer func() {
		r.FinishedAt = time.Now().Unix()
		if len(r.Summary) > 16000 {
			r.Summary = r.Summary[:16000]
		}
		data, _ := json.Marshal(r)
		if err := atomicWrite(j.ResultPath, data); err != nil {
			workerErr = err
		}
	}()
	rules := ""
	for _, c := range j.Capabilities {
		if c.State == "active" {
			rules += "\n" + c.Kind + " " + c.Name + ":\n" + c.Content
		}
	}
	handoff := fmt.Sprintf("Project goal: %s\nTask: %s\nAcceptance: %s\n", j.Goal, j.Task.Title, j.Task.Acceptance)
	if j.Board != nil {
		shared, _ := json.Marshal(j.Board)
		handoff += "\nShared plan and acceptance evidence:\n" + string(shared)
	}
	checkpoint := func() {
		progress := r
		progress.State = "running"
		data, _ := json.Marshal(progress)
		_ = atomicWrite(filepath.Join(filepath.Dir(spec), "progress.json"), data)
	}
	current := j.Stage.Primary
	for attempt := 0; attempt < j.Stage.MaxAttempts; attempt++ {
		if _, err := os.Stat(filepath.Join(filepath.Dir(spec), "stop")); err == nil {
			r.Summary = "Paused before the next attempt. Existing work is preserved."
			return nil
		}
		r.Attempts++
		if attempt == 2 || (attempt == 1 && r.Summary == "executor unavailable") {
			current = j.Stage.Secondary
			r.Switched = true
		}
		checkpoint()
		fmt.Printf("Attempt %d: %s / %s\n", r.Attempts, current.Harness, current.Model)
		if len(handoff) > 16000 {
			handoff = fmt.Sprintf("Project goal: %s\nTask: %s\nAcceptance: %s\nRecent shared checkpoint:\n", j.Goal, j.Task.Title, j.Task.Acceptance) + handoff[len(handoff)-12000:]
		}
		turn, stop := context.WithTimeout(ctx, time.Duration(j.Stage.AttemptMinutes)*time.Minute)
		defer stop()
		ans, runErr := runner(turn, current, j.Run.Workspace, handoff+"\nProject capabilities:\n"+rules+"\nWork only on this task in the supplied workspace. Preserve previous work. Do not deploy, push, delete source data or change credentials. Finish with a concise handoff: modifications, evidence, unresolved issues and next step.", true)
		if ans.CostUSD != nil {
			if r.CostUSD == nil {
				v := 0.0
				r.CostUSD = &v
			}
			*r.CostUSD += *ans.CostUSD
			r.CostKind = "partial"
		}
		if runErr != nil {
			r.Summary = "executor unavailable"
			if errors.Is(runErr, ErrNeedsConfirmation) {
				r.Summary = "Execution needs user input or permission. Review the plan before retrying."
				return nil
			}
			handoff += "\nPrevious executor failed; inspect existing changes and continue without replaying side effects.\n"
			if ctx.Err() != nil {
				r.Summary = "Stage budget exhausted. Work is preserved."
				break
			}
			continue
		}
		if len(ans.Text) > 16000 {
			ans.Text = ans.Text[:16000]
		}
		handoff += "\nLatest handoff:\n" + ans.Text
		r.Summary = ans.Text
		if len(r.Summary) > 14000 {
			r.Summary = r.Summary[:14000]
		}
		checks := []string{}
		passed := true
		for _, command := range j.Task.Verify {
			check, stop := context.WithTimeout(turn, time.Duration(j.Stage.AttemptMinutes)*time.Minute)
			cmd := exec.CommandContext(check, "sh", "-c", command)
			cmd.Dir = j.Run.Workspace
			cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
			cmd.WaitDelay = 5 * time.Second
			cmd.Cancel = func() error {
				if cmd.Process == nil {
					return nil
				}
				return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			}
			var output boundedBuffer
			cmd.Stdout = &output
			cmd.Stderr = &output
			err = cmd.Run()
			stop()
			status := "PASS"
			if err != nil {
				status = "FAIL"
				passed = false
			}
			checks = append(checks, status+" "+command)
			if !passed {
				snippet := output.String()
				if len(snippet) > 8000 {
					snippet = snippet[len(snippet)-8000:]
				}
				handoff += "\nVerification failed:\n" + snippet
				break
			}
		}
		r.Summary += "\nVerification:\n" + strings.Join(checks, "\n")
		checkpoint()
		if !passed {
			continue
		}
		// A fresh read-only reviewer sees the accepted criteria and repository, not
		// the implementer's assertion of success alone.
		reviewer := j.Stage.Secondary
		if r.Switched {
			reviewer = j.Stage.Primary
		}
		reviewCtx, stop := context.WithTimeout(turn, time.Duration(j.Stage.AttemptMinutes)*time.Minute)
		review, reviewErr := runner(reviewCtx, reviewer, j.Run.Workspace, "Independently review this task against the acceptance criteria. Read the diff and tests. Do not edit files. Reply JSON only: {\"passed\":true or false,\"evidence\":\"specific findings\"}.\n"+handoff, false)
		stop()
		if review.CostUSD != nil {
			if r.CostUSD == nil {
				amount := 0.0
				r.CostUSD = &amount
			}
			*r.CostUSD += *review.CostUSD
			r.CostKind = "partial"
		}
		var verdict struct {
			Passed   bool   `json:"passed"`
			Evidence string `json:"evidence"`
		}
		if reviewErr != nil || json.Unmarshal([]byte(review.Text), &verdict) != nil || verdict.Evidence == "" {
			r.State = "review"
			r.Summary += "\nIndependent review unavailable; human acceptance required."
			return nil
		}
		r.Summary += "\nReview: " + verdict.Evidence
		if !verdict.Passed {
			handoff += "\nReview findings: " + verdict.Evidence
			continue
		}
		if len(j.Task.Verify) == 0 {
			r.State = "review"
			r.Summary += "\nNo executable acceptance check was specified; human acceptance required."
		} else {
			r.State = "done"
		}
		fmt.Printf("Task %s: %s (%s)\n", j.Task.ID, r.State, time.Since(start).Round(time.Second))
		return nil
	}
	if r.Summary == "" {
		r.Summary = "No attempts remain. Inspect the preserved workspace and session."
	}
	return nil
}
func atomicWrite(path string, data []byte) error {
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		return err
	}
	return os.Rename(temp, path)
}
