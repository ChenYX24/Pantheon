package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/id"
	"github.com/jiangmuran/vibepanel/internal/parthenon"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

func (s *Server) registerWorkflowRoutes(r chi.Router) {
	r.Get("/workflow/settings", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]bool{"executionEnabled": s.Cfg.WorkflowExecute, "notificationsEnabled": !s.Cfg.PlanningOnly && s.Chat != nil, "development": s.Cfg.Development})
	})
	r.Get("/projects/{id}/capability-inventory", func(w http.ResponseWriter, r *http.Request) {
		p, err := s.DB.GetProject(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		writeJSON(w, 200, parthenon.Inventory(p.Path))
	})

	r.Get("/workflow/recipients", func(w http.ResponseWriter, r *http.Request) {
		peers, err := s.DB.PairedChatPeers(r.Context())
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		out := []map[string]string{}
		for _, p := range peers {
			out = append(out, map[string]string{"channel": p.Channel, "peerId": p.PeerID, "name": p.Display})
		}
		writeJSON(w, 200, out)
	})
	r.Get("/projects/{id}/notifications", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.DB.WorkflowNotices(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		writeJSON(w, 200, items)
	})
	r.Post("/projects/{id}/stages/{stage}/notify", func(w http.ResponseWriter, r *http.Request) {
		if s.Cfg.PlanningOnly || s.Chat == nil {
			writeErr(w, 409, "notification delivery is disabled in this preview")
			return
		}
		var n store.WorkflowNotice
		if !decode(w, r, &n) {
			return
		}
		n.ProjectID = chi.URLParam(r, "id")
		n.StageID = chi.URLParam(r, "stage")
		saved, err := s.DB.QueueWorkflowNotice(r.Context(), n)
		if err != nil {
			s.workflowError(w, err)
			return
		}
		writeJSON(w, 201, saved)
	})

	r.Get("/workflow/executors", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, parthenon.Executors()) })
	r.Get("/projects/{id}/workflow", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.DB.WorkflowView(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		writeJSON(w, 200, v)
	})
	r.Post("/projects/{id}/discussion", s.handleProjectDiscussion)
	r.Post("/projects/{id}/stages/{stage}/approve", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Rev int64 `json:"rev"`
		}
		if !decode(w, r, &req) {
			return
		}
		user, _ := currentUserFrom(r)
		a, err := s.DB.ApproveStage(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "stage"), user.Username, req.Rev)
		if err != nil {
			s.workflowError(w, err)
			return
		}
		writeJSON(w, 200, a)
	})
	r.Post("/projects/{id}/stages/{stage}/pause", func(w http.ResponseWriter, r *http.Request) {
		err := s.DB.PauseStage(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "stage"))
		if err != nil {
			s.workflowError(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"paused": true})
	})
	r.Post("/projects/{id}/capabilities", func(w http.ResponseWriter, r *http.Request) {
		var c store.Capability
		if !decode(w, r, &c) {
			return
		}
		c.ID = ""
		saved, err := s.DB.SaveCapability(r.Context(), chi.URLParam(r, "id"), c)
		if err != nil {
			s.workflowError(w, err)
			return
		}
		writeJSON(w, 201, saved)
	})
	r.Post("/projects/{id}/capabilities/{cap}/activate", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Revision int `json:"revision"`
		}
		if !decode(w, r, &req) {
			return
		}
		err := s.DB.ActivateCapability(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "cap"), req.Revision)
		if err != nil {
			s.workflowError(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"active": true})
	})
	r.Get("/projects/{id}/handoff", func(w http.ResponseWriter, r *http.Request) {
		pid := chi.URLParam(r, "id")
		b, err := s.DB.GetProjectBoard(r.Context(), pid)
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		v, err := s.DB.WorkflowView(r.Context(), pid)
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"schemaVersion": 1, "board": b, "sharedState": v, "generatedAt": time.Now().Unix(), "executionEnabled": s.Cfg.WorkflowExecute})
	})
}
func (s *Server) workflowError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrBoardStale) || errors.Is(err, store.ErrWorkflowBusy) {
		writeErr(w, 409, err.Error())
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, 404, "not found")
		return
	}
	writeErr(w, 400, err.Error())
}
func (s *Server) handleProjectDiscussion(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var req struct {
		Message  string                `json:"message"`
		Executor store.ModelAssignment `json:"executor"`
	}
	if !decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Message) == "" || len(req.Message) > 16000 {
		writeErr(w, 400, "message must be between 1 and 16000 bytes")
		return
	}
	b, err := s.DB.GetProjectBoard(r.Context(), pid)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	p, err := s.DB.GetProject(r.Context(), pid)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	v, err := s.DB.WorkflowView(r.Context(), pid)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if _, err = s.DB.AddWorkflowMessage(r.Context(), pid, "user", req.Message, nil); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	reply, err := parthenon.Discuss(parthenon.WithAgentScope(ctx, s.Cfg.AgentScope), s.WorkflowRunner, req.Executor, p.Path, req.Message, b, v)
	if err != nil {
		_, _ = s.DB.AddWorkflowMessage(context.WithoutCancel(r.Context()), pid, "system", "项目经理暂未完成本轮："+err.Error(), nil)
		writeErr(w, 502, err.Error())
		return
	}
	message, err := s.DB.AddWorkflowMessage(r.Context(), pid, "assistant", reply.Reply, reply.Proposal)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, message)
}

// The scheduler owns no agent process. It starts a worker in the configured
// tmux and reconciles its on-disk receipt after restart before claiming work.
func (s *Server) RunWorkflow(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		s.workflowTick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Server) workflowTick(ctx context.Context) {
	runs, err := s.DB.ActiveWorkflowRuns(ctx)
	if err != nil {
		return
	}
	for _, r := range runs {
		dir := filepath.Join(s.Cfg.DataDir, "workflow", "runs", r.ID)
		if r.State == "stopping" {
			_ = os.WriteFile(filepath.Join(dir, "stop"), []byte("pause requested\n"), 0600)
		}
		raw, err := os.ReadFile(filepath.Join(dir, "result.json"))
		if err == nil {
			var result store.WorkflowRun
			if json.Unmarshal(raw, &result) == nil && result.ID == r.ID && result.ProjectID == r.ProjectID && result.TaskID == r.TaskID && (result.State == "done" || result.State == "review" || result.State == "blocked") {
				if r.State == "stopping" {
					result.State = "blocked"
					result.Summary = "Paused. " + result.Summary
				}
				_ = s.DB.FinishWorkflowRun(ctx, result)
				continue
			}
		}
		if r.State == "running" {
			if raw, e := os.ReadFile(filepath.Join(dir, "progress.json")); e == nil {
				var progress store.WorkflowRun
				if json.Unmarshal(raw, &progress) == nil && progress.ID == r.ID && progress.ProjectID == r.ProjectID && progress.TaskID == r.TaskID && progress.State == "running" {
					_ = s.DB.UpdateWorkflowRun(ctx, progress)
				}
			}
		}
		if r.SessionID != "" {
			info, e := s.Tmux.Get(ctx, id.TmuxName(r.SessionID))
			if e == nil && !info.Dead {
				continue
			}
		}
		if time.Now().Unix()-r.StartedAt > 30 {
			r.State = "blocked"
			r.Summary = "Worker not found after reconciliation; inspect preserved files before retrying."
			_ = s.DB.FinishWorkflowRun(ctx, r)
		}
	}
	if !s.Cfg.PlanningOnly && s.Chat != nil {
		notices, err := s.DB.WorkflowNotices(ctx, "")
		if err == nil {
			for _, n := range notices {
				if n.State != "pending" || n.NextAttemptAt > time.Now().Unix() {
					continue
				}
				if n.ExpiresAt <= time.Now().Unix() {
					n.State = "expired"
				} else {
					n.Attempts++
					sendctx, cancel := context.WithTimeout(ctx, 15*time.Second)
					err = s.Chat.SendWorkflowNotice(sendctx, n)
					cancel()
					if err == nil {
						n.State = "sent"
						n.LastError = ""
					} else {
						n.LastError = "Delivery failed; check channel status"
						n.NextAttemptAt = time.Now().Unix() + int64(n.Attempts*60)
						if n.Attempts >= 3 {
							n.State = "failed"
						}
					}
				}
				_ = s.DB.UpdateWorkflowNotice(ctx, n)
			}
		}
	}

	if !s.Cfg.WorkflowExecute {
		return
	}
	projects, err := s.DB.ListProjects(ctx)
	if err != nil {
		return
	}
	for _, p := range projects {
		r, b, stage, task, err := s.DB.ClaimNext(ctx, p.ID)
		if err != nil {
			continue
		}
		if err = s.launchWorkflow(ctx, &r, p, b, stage, task); err != nil {
			r.State = "blocked"
			r.Summary = "Execution could not start: " + err.Error()
			_ = s.DB.FinishWorkflowRun(ctx, r)
		}
	}
}
func (s *Server) launchWorkflow(ctx context.Context, r *store.WorkflowRun, p store.Project, b store.ProjectBoard, stage store.BoardStage, task store.BoardTask) error {
	root := filepath.Join(s.Cfg.DataDir, "workflow")
	workspace := filepath.Join(root, "workspaces", p.ID)
	runDir := filepath.Join(root, "runs", r.ID)
	if err := os.MkdirAll(runDir, 0700); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(workspace, ".git")); err != nil {
		if err = os.MkdirAll(filepath.Dir(workspace), 0700); err != nil {
			return err
		}
		check := exec.CommandContext(ctx, "git", "-C", p.Path, "status", "--porcelain")
		raw, err := check.Output()
		if err != nil {
			return errors.New("automatic execution requires a Git project")
		}
		if len(raw) > 0 {
			return errors.New("source has uncommitted changes; create a reviewed checkpoint before automated execution")
		}
		cmd := exec.CommandContext(ctx, "git", "-C", p.Path, "worktree", "add", "--detach", workspace, "HEAD")
		if err = cmd.Run(); err != nil {
			return errors.New("could not prepare an isolated worktree")
		}
	}
	r.Workspace = workspace
	r.SessionID = id.New()
	r.State = "running"
	v, err := s.DB.WorkflowView(ctx, p.ID)
	if err != nil {
		return err
	}
	j := parthenon.Job{AgentScope: s.Cfg.AgentScope, Run: *r, Stage: stage, Task: task, Goal: b.Goal, Capabilities: v.Capabilities, Board: &b, ResultPath: filepath.Join(runDir, "result.json")}
	data, err := json.Marshal(j)
	if err != nil {
		return err
	}
	spec := filepath.Join(runDir, "job.json")
	if err = os.WriteFile(spec, data, 0600); err != nil {
		return err
	}
	binary, err := os.Executable()
	if err != nil {
		return err
	}
	if err = s.DB.UpdateWorkflowRun(ctx, *r); err != nil {
		return err
	}
	name := id.TmuxName(r.SessionID)
	argv := []string{binary, "workflow-worker", spec}
	if err = s.Tmux.Create(ctx, tmux.CreateOptions{Name: name, Dir: workspace, Command: argv, Width: 100, Height: 32}); err != nil {
		return err
	}
	if _, err = s.DB.CreateSession(ctx, store.Session{ID: r.SessionID, ProjectID: p.ID, TmuxName: name, Title: "任务 · " + task.Title, CWD: workspace, Cols: 100, Rows: 32, State: session.StateWorking, LaunchCommand: argv}); err != nil {
		_ = s.Tmux.Kill(context.WithoutCancel(ctx), name)
		return err
	}
	_, _ = s.Manager.Attach(ctx, r.SessionID, name, 100, 32)
	s.notifyState()
	_ = s.DB.WorkflowEvent(ctx, p.ID, "task.started", fmt.Sprintf("%s; primary %s/%s; secondary %s/%s", task.ID, stage.Primary.Harness, stage.Primary.Model, stage.Secondary.Harness, stage.Secondary.Model))
	return nil
}
