package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/id"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/parthenon"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

type homeExecution struct {
	mu       sync.Mutex
	vanished map[string]time.Time
	start    func(context.Context, tmux.CreateOptions) error
	alive    func(context.Context, string) (bool, error)
}

func (s *Server) registerHomeExecutionRoutes(r chi.Router) {
	r.Get("/home/execution", s.handleHomeExecution)
	r.Put("/home/execution", s.handleHomeExecution)
	r.Get("/home/projects/{id}/runs", s.handleHomeRuns)
	r.Get("/home/projects/{id}/runs/{runId}", s.handleHomeRun)
	r.Post("/home/projects/{id}/tasks/{taskId}/run", s.handleHomeTaskRun)
	r.Post("/home/projects/{id}/runs/{runId}/stop", s.handleHomeRunStop)
	r.Post("/home/projects/{id}/runs/{runId}/merge", s.handleHomeRunMerge)
}

func homeExecutionRoute(method, path string) bool {
	if path == "/api/home/execution" {
		return method == http.MethodGet || method == http.MethodPut
	}
	parts := strings.Split(strings.TrimPrefix(path, "/api/"), "/")
	if len(parts) < 4 || parts[0] != "home" || parts[1] != "projects" || parts[2] == "" {
		return false
	}
	if parts[3] == "runs" {
		if len(parts) == 4 || (len(parts) == 5 && parts[4] != "") {
			return method == http.MethodGet
		}
		return len(parts) == 6 && parts[4] != "" && (parts[5] == "stop" || parts[5] == "merge") && method == http.MethodPost
	}
	return len(parts) == 6 && parts[3] == "tasks" && parts[4] != "" && parts[5] == "run" && method == http.MethodPost
}

func (s *Server) homeExecutionEnabled(ctx context.Context) (bool, error) {
	value, err := s.DB.GetSetting(ctx, "home.execute.enabled", "false")
	return s.Cfg.HomeExecute == "allow" && value == "true", err
}

func (s *Server) handleHomeExecution(w http.ResponseWriter, r *http.Request) {
	s.homeExecution.mu.Lock()
	defer s.homeExecution.mu.Unlock()
	if r.Method == http.MethodPut {
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if !decode(w, r, &req) {
			return
		}
		if req.Enabled == nil {
			writeErr(w, 400, "enabled is required")
			return
		}
		if s.Cfg.HomeExecute != "allow" {
			writeErr(w, 409, "home execution is disabled by --home-execute off")
			return
		}
		if err := s.DB.SetSetting(r.Context(), "home.execute.enabled", fmt.Sprint(*req.Enabled)); err != nil {
			s.writeStoreErr(w, err)
			return
		}
	}
	enabled, err := s.homeExecutionEnabled(r.Context())
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	active, err := s.DB.ActiveHomeRuns(r.Context())
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"flag": s.Cfg.HomeExecute, "enabled": enabled, "maxRuns": s.Cfg.HomeMaxRuns, "active": active})
}

func (s *Server) handleHomeRuns(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.homeProject(w, r); !ok {
		return
	}
	runs, err := s.DB.HomeRuns(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, runs)
}

func (s *Server) handleHomeRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.DB.HomeRun(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "runId"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	log := ""
	if s.Tmux != nil && run.SessionID != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		log, _ = s.Tmux.CaptureLines(ctx, id.TmuxName(run.SessionID), 300)
		cancel()
		if len(log) > 16<<10 {
			log = log[len(log)-(16<<10):]
		}
	}
	handoff, _, _ := s.Home.Handoff(s.Cfg.CyxHome, run.ProjectID, run.TaskID, run.ID)
	writeJSON(w, 200, struct {
		store.HomeRun
		Log     string `json:"log"`
		Handoff string `json:"handoff"`
	}{run, log, handoff})
}

func (s *Server) handleHomeTaskRun(w http.ResponseWriter, r *http.Request) {
	s.homeExecution.mu.Lock()
	defer s.homeExecution.mu.Unlock()
	detail, ok := s.homeProject(w, r)
	if !ok {
		return
	}
	taskID := chi.URLParam(r, "taskId")
	for _, task := range home.EligibleTasks(detail, true) {
		if task.ID != taskID {
			continue
		}
		run, err := s.claimHomeTask(r.Context(), detail, task)
		if err != nil {
			writeErr(w, 409, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, run)
		return
	}
	writeErr(w, 409, "task must be planned, all dependencies must be done, and execution settings must be valid")
}

func (s *Server) homeRunDir(run store.HomeRun) string {
	return filepath.Join(s.Cfg.DataDir, "home-runs", run.ProjectID, run.ID+".d")
}

func (s *Server) handleHomeRunStop(w http.ResponseWriter, r *http.Request) {
	s.homeExecution.mu.Lock()
	defer s.homeExecution.mu.Unlock()
	run, err := s.DB.HomeRun(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "runId"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if !run.Active() {
		writeErr(w, 409, "only an active run can be stopped")
		return
	}
	if err := os.WriteFile(filepath.Join(s.homeRunDir(run), "stop"), []byte("stop requested\n"), 0600); err != nil {
		writeErr(w, 500, "could not write stop request")
		return
	}
	// Keep the writer reservation until the process acknowledges cancellation.
	// Releasing it here can launch the next task while the old agent still writes.
	writeJSON(w, http.StatusAccepted, run)
}

func writeHomeJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err = os.WriteFile(path+".tmp", data, 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

func readHomeJSON(path string, value any) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return json.NewDecoder(io.LimitReader(file, 1<<20)).Decode(value)
}

func (s *Server) claimHomeTask(ctx context.Context, detail home.Detail, task home.Task) (store.HomeRun, error) {
	run := store.HomeRun{}
	enabled, err := s.homeExecutionEnabled(ctx)
	if err != nil {
		return run, err
	}
	if !enabled {
		return run, errors.New("home execution is disabled by the flag or runtime switch")
	}
	if !detail.Project.PathExists {
		return run, errors.New("the project checkout directory is missing")
	}
	checkout := detail.Project.Path
	root, err := parthenon.HomeGit(ctx, checkout, "rev-parse", "--show-toplevel")
	resolved, resolveErr := filepath.EvalSymlinks(checkout)
	if err != nil || resolveErr != nil || filepath.Clean(root) != filepath.Clean(resolved) {
		return run, errors.New("execution requires the root of a Git checkout")
	}
	base, err := parthenon.HomeGit(ctx, checkout, "rev-parse", "--verify", "HEAD")
	if err != nil {
		return run, errors.New("execution requires a Git checkout with a HEAD commit")
	}
	dirty, err := parthenon.HomeGit(ctx, checkout, "status", "--porcelain")
	if err != nil {
		return run, errors.New("execution requires a Git working tree")
	}
	primary, secondary, err := parthenon.HomeAssignments(task, parthenon.Models())
	if err != nil {
		return run, err
	}
	run = store.HomeRun{ID: id.New(), ProjectID: detail.Project.ID, TaskID: task.ID, State: "running", Attempt: 1, Harness: primary.Harness, Model: primary.Model, Reviewer: secondary.Harness + "/" + secondary.Model, BaseCommit: base, StartedAt: time.Now().Unix(), SessionID: id.New(), Checks: []store.HomeCheck{}}
	run.Worktree = filepath.Join(s.Cfg.DataDir, "home-runs", run.ProjectID, run.ID)
	if dirty != "" {
		run.Summary = "Warning: checkout has uncommitted changes; they are not carried into this run's worktree."
	}
	if err = s.DB.ClaimHomeRun(ctx, run, s.Cfg.HomeMaxRuns); err != nil {
		return run, err
	}
	if err = s.prepareHomeRun(ctx, detail, task, primary, secondary, &run); err != nil {
		result := parthenon.HomeResult{HomeRun: run}
		result.State, result.Summary, result.FinishedAt = "failed", "Execution could not start: "+err.Error(), time.Now().Unix()
		if e := os.MkdirAll(s.homeRunDir(run), 0700); e == nil {
			_ = writeHomeJSON(filepath.Join(s.homeRunDir(run), "result.json"), result)
		}
		// The ticker retries file reconciliation if a writer was temporarily
		// unavailable; do not release the reservation and lose the receipt.
		_ = s.finishHomeRun(context.WithoutCancel(ctx), result)
		return run, err
	}
	return run, nil
}

func (s *Server) prepareHomeRun(ctx context.Context, detail home.Detail, task home.Task, primary, secondary store.ModelAssignment, run *store.HomeRun) error {
	if err := os.MkdirAll(s.homeRunDir(*run), 0700); err != nil {
		return err
	}
	branch := "pantheon/" + task.ID
	for n := 2; ; n++ {
		if _, err := parthenon.HomeGit(ctx, detail.Project.Path, "show-ref", "--verify", "--quiet", "refs/heads/"+branch); err != nil {
			break
		}
		branch = fmt.Sprintf("pantheon/%s-%d", task.ID, n)
	}
	run.Branch = branch
	if _, err := parthenon.HomeGit(ctx, detail.Project.Path, "worktree", "add", "-b", branch, run.Worktree, run.BaseCommit); err != nil {
		return err
	}
	_, latest, err := s.Home.Handoff(s.Cfg.CyxHome, run.ProjectID, task.ID, "")
	if err != nil {
		return err
	}
	job := parthenon.HomeJob{Run: *run, Task: task, Primary: primary, Secondary: secondary, Meta: detail.Project.Meta, AgentScope: s.Cfg.AgentScope, ActiveContext: detail.ActiveContext, Handoff: latest, Resources: s.homeResourcePrompt(run.ProjectID)}
	spec := filepath.Join(s.homeRunDir(*run), "job.json")
	if err := writeHomeJSON(spec, job); err != nil {
		return err
	}
	if err := s.DB.UpdateHomeRun(ctx, *run); err != nil {
		return err
	}
	status, reason := "in_progress", ""
	if _, err := s.Home.Patch(s.Cfg.CyxHome, run.ProjectID, task.ID, home.PatchTask{Rev: task.Rev, Status: &status, Session: &run.SessionID, BlockedReason: &reason}); err != nil {
		return err
	}
	p, err := s.homeRunProject(ctx, detail.Project)
	if err != nil {
		return err
	}
	binary, err := os.Executable()
	if err != nil {
		return err
	}
	argv := []string{binary, "home-worker", spec}
	name := id.TmuxName(run.SessionID)
	start := s.homeExecution.start
	if start == nil {
		if s.Tmux == nil {
			return errors.New("tmux is unavailable")
		}
		start = s.Tmux.Create
	}
	// Store the row before launching; no live worker may become invisible if
	// SQLite fails after tmux has accepted it.
	if _, err := s.DB.CreateSession(ctx, store.Session{ID: run.SessionID, ProjectID: p.ID, TmuxName: name, Title: "任务 · " + task.Title, CWD: run.Worktree, Cols: 100, Rows: 32, State: session.StateWorking, LaunchCommand: argv}); err != nil {
		return err
	}
	if err := start(ctx, tmux.CreateOptions{Name: name, Dir: run.Worktree, Command: argv, Width: 100, Height: 32}); err != nil {
		return err
	}
	if s.Manager != nil {
		_, _ = s.Manager.Attach(ctx, run.SessionID, name, 100, 32)
	}
	s.notifyState()
	return nil
}

func (s *Server) homeRunProject(ctx context.Context, project home.Project) (store.Project, error) {
	if project.PanelProjectID != nil {
		p, err := s.DB.GetProject(ctx, *project.PanelProjectID)
		if err == nil && p.ArchivedAt != nil {
			err = s.DB.RestoreProject(ctx, p.ID)
		}
		return p, err
	}
	abs, err := filepath.Abs(project.Path)
	if err != nil {
		return store.Project{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return store.Project{}, err
	}
	if !info.IsDir() {
		return store.Project{}, errors.New("checkout is not a directory")
	}
	return s.DB.CreateProject(ctx, id.New(), project.ID, abs)
}

// Like workflow execution, tmux owns the worker. The first tick reconciles old
// receipts before claiming anything and does so even with execution switched off.
func (s *Server) RunHomeExecution(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		s.homeExecutionTick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Server) homeExecutionTick(ctx context.Context) {
	s.homeExecution.mu.Lock()
	defer s.homeExecution.mu.Unlock()
	runs, err := s.DB.ActiveHomeRuns(ctx)
	if err != nil {
		return
	}
	for _, run := range runs {
		if err := s.reconcileHomeRun(ctx, run, time.Now()); err != nil && s.Log != nil {
			s.Log.Warn("home run reconciliation", "run", run.ID, "err", err)
		}
	}
	if enabled, err := s.homeExecutionEnabled(ctx); err != nil || !enabled {
		return
	}
	snapshot, err := s.homeSnapshot(ctx, false)
	if err != nil || !snapshot.Available {
		return
	}
	type candidate struct {
		detail home.Detail
		task   home.Task
	}
	candidates := []candidate{}
	for _, project := range snapshot.Projects {
		if project.ActiveRun != nil {
			continue
		}
		detail := snapshot.Details[project.ID]
		if tasks := home.EligibleTasks(detail, false); len(tasks) > 0 {
			candidates = append(candidates, candidate{detail, tasks[0]})
		}
	}
	sort.SliceStable(candidates, func(a, b int) bool {
		return home.TaskBefore(candidates[a].task, candidates[b].task)
	})
	for _, next := range candidates {
		if _, err := s.claimHomeTask(ctx, next.detail, next.task); errors.Is(err, store.ErrHomeRunBusy) {
			return
		}
	}
}
