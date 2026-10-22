package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/chat"
	"github.com/jiangmuran/vibepanel/internal/id"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/resources"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/sysmon"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

type rolloverStatus struct {
	State        string `json:"state"`
	Handoff      string `json:"handoff"`
	StartedAt    int64  `json:"startedAt"`
	Error        string `json:"error"`
	NewSessionID string `json:"newSessionId,omitempty"`
}

type rolloverResult struct {
	Handoff      string `json:"handoff"`
	NewSessionID string `json:"newSessionId,omitempty"`
}

type rolloverRequest struct {
	Reason string `json:"reason"`
	Resume bool   `json:"resume"`
}

type rolloverState struct {
	mu      sync.Mutex
	states  map[string]rolloverStatus
	actions map[string]string
	// Tests replace all pane operations and time; none needs a tmux server.
	hooks    *rolloverHooks
	terminal rolloverTerminal
}

type rolloverTerminal interface {
	Get(context.Context, string) (tmux.Info, error)
	Paste(context.Context, string, string) error
	Keys(context.Context, string, ...string) error
	CaptureLines(context.Context, string, int) (string, error)
	Create(context.Context, tmux.CreateOptions) error
	ServerPID(context.Context) (int, error)
}

func (s *Server) rolloverTerminal() rolloverTerminal {
	if s.rollovers.terminal != nil {
		return s.rollovers.terminal
	}
	return s.Tmux
}

type rolloverHooks struct {
	now        func() time.Time
	wait       func(context.Context, time.Duration) error
	send       func(context.Context, store.Session, string) error
	capture    func(context.Context, store.Session, int) (string, error)
	end        func(context.Context, store.Session) error
	prepareEnd func(context.Context, store.Session) (func(context.Context) error, error)
	create     func(context.Context, store.Session) (store.Session, error)
	ready      func(context.Context, store.Session) (bool, error)
	memory     func() (uint64, uint64)
	alert      func() bool
	held       func(store.Session) uint64
	// gone reports that the pane's agent has exited. Nothing can answer a
	// handoff request after that, so waiting out the grace is pure delay.
	gone func(context.Context, store.Session) bool
}

var errRolloverConflict = errors.New("session is already rolling over or archived")

func homeWorkerSession(row store.Session) bool {
	return len(row.LaunchCommand) > 1 && row.LaunchCommand[1] == "home-worker"
}

func rolloverAgent(row store.Session) bool {
	known := func(s string) bool { return s == "claude" || s == "codex" }
	return known(row.Command) || len(row.LaunchCommand) > 0 && known(filepath.Base(row.LaunchCommand[0]))
}

func rolloverReason(reason string) string {
	switch reason {
	case "manual":
		return "手动交接"
	case "memory":
		return "内存不足"
	case "long":
		return "会话时间过长"
	}
	return ""
}

func handoffPrompt(reason, path string) string {
	return "[Pantheon] 需要结束本会话（原因：" + rolloverReason(reason) + "）。请立即把当前工作写成交接文档，保存到 " + path + "，使用 Markdown 标题：目标、已完成、未完成、关键文件与命令（可选）、下一步、验证命令、禁止事项。写完后只回复 HANDOFF-DONE，不要做别的事。"
}

func (s *Server) rolloverStatus(id string) rolloverStatus {
	s.rollovers.mu.Lock()
	defer s.rollovers.mu.Unlock()
	if status, ok := s.rollovers.states[id]; ok {
		return status
	}
	return rolloverStatus{State: "idle"}
}

func activeRollover(state string) bool {
	return state == "asking" || state == "waiting" || state == "ending" || state == "verifying" || state == "handed_off" || state == "confirmed"
}
func (s *Server) RollingOver(id string) bool { return activeRollover(s.rolloverStatus(id).State) }

func (s *Server) handleRolloverStatus(w http.ResponseWriter, r *http.Request) {
	row, err := s.DB.GetSession(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	status := s.rolloverStatus(row.ID)
	if status.State == "idle" && strings.HasPrefix(row.ArchiveNote, "rolled over → ") {
		status.State, status.Handoff = "done", strings.TrimPrefix(row.ArchiveNote, "rolled over → ")
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleRollover(w http.ResponseWriter, r *http.Request) {
	var req rolloverRequest
	if !decode(w, r, &req) {
		return
	}
	if rolloverReason(req.Reason) == "" {
		writeErr(w, http.StatusBadRequest, "reason must be manual, memory or long")
		return
	}
	result, err := s.runRollover(context.WithoutCancel(r.Context()), chi.URLParam(r, "id"), req, 0)
	if err != nil {
		switch {
		case errors.Is(err, errRolloverConflict):
			writeErr(w, http.StatusConflict, err.Error())
		case errors.Is(err, store.ErrNotFound):
			s.writeStoreErr(w, err)
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, rolloverResult{Handoff: result.Handoff, NewSessionID: result.NewSessionID})
}

// RolloverMemory is the governor's one-at-a-time action. The request and the
// governor share the same per-session lock, so neither can send a second prompt.
func (s *Server) RolloverMemory(sid string, resume bool, grace time.Duration) error {
	_, err := s.runRollover(context.Background(), sid, rolloverRequest{Reason: "memory", Resume: resume}, grace)
	return err
}

func rolloverWait(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Server) rolloverRuntime() rolloverHooks {
	if s.rollovers.hooks != nil {
		return *s.rollovers.hooks
	}
	return rolloverHooks{
		now: time.Now, wait: rolloverWait, memory: sysmon.Memory,
		alert: func() bool { return s.Resources != nil && s.Resources.Alert() != nil },
		send: func(ctx context.Context, row store.Session, text string) error {
			ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			info, err := s.rolloverTerminal().Get(ctx, row.TmuxName)
			if err != nil {
				return err
			}
			if info.Dead {
				return errors.New("agent exited before input")
			}
			// Recheck the current pane as well as its recorded launch command. Never
			// submit a handoff prompt to a shell left behind after an agent exited.
			if !rolloverAgent(store.Session{Command: info.Command}) && info.Command != "node" {
				return errors.New("pane is not an agent")
			}
			if err := s.rolloverTerminal().Paste(ctx, row.TmuxName, text); err != nil {
				return err
			}
			if err := rolloverWait(ctx, 100*time.Millisecond); err != nil {
				return err
			}
			return s.rolloverTerminal().Keys(ctx, row.TmuxName, "Enter")
		},
		capture: func(ctx context.Context, row store.Session, lines int) (string, error) {
			ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			return s.rolloverTerminal().CaptureLines(ctx, row.TmuxName, lines)
		},
		prepareEnd: func(ctx context.Context, row store.Session) (func(context.Context) error, error) {
			info, err := s.rolloverTerminal().Get(ctx, row.TmuxName)
			if err != nil {
				return nil, err
			}
			governor := s.Resources
			if governor == nil {
				governor = resources.New(resources.Env{ServerPID: s.rolloverTerminal().ServerPID, Sessions: func() []resources.SessionMeta { return []resources.SessionMeta{{ID: row.ID, TmuxName: row.TmuxName}} }, Panes: func() []resources.Pane { return []resources.Pane{{TmuxName: row.TmuxName, PID: info.PID}} }})
			}
			end, err := governor.PrepareRolloverEnd(ctx, row.ID)
			if err != nil {
				return nil, err
			}
			return func(ctx context.Context) error {
				current, err := s.rolloverTerminal().Get(ctx, row.TmuxName)
				if err != nil {
					return err
				}
				if current.PID != info.PID {
					return resources.ErrGone
				}
				return end(ctx)
			}, nil
		},
		create: s.createRolloverSession,
		gone: func(ctx context.Context, row store.Session) bool {
			ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			info, err := s.rolloverTerminal().Get(ctx, row.TmuxName)
			return err == nil && info.Dead
		},
		ready: func(ctx context.Context, row store.Session) (bool, error) {
			ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			info, err := s.rolloverTerminal().Get(ctx, row.TmuxName)
			if err != nil {
				return false, err
			}
			if info.Dead {
				return false, errors.New("new session exited before it was ready")
			}
			current, err := s.DB.GetSession(ctx, row.ID)
			if err != nil {
				return false, err
			}
			if !rolloverAgent(store.Session{Command: info.Command}) && info.Command != "node" {
				return false, nil
			}
			return current.State == session.StateWaiting || current.State == session.StateDone || s.rolloverSettled(current, time.Now()), nil
		},
		held: func(row store.Session) uint64 {
			if s.Resources != nil {
				return s.Resources.SessionHeld(row.ID)
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			info, err := s.rolloverTerminal().Get(ctx, row.TmuxName)
			if err != nil {
				return 0
			}
			g := resources.New(resources.Env{Sessions: func() []resources.SessionMeta { return []resources.SessionMeta{{ID: row.ID, TmuxName: row.TmuxName}} }, Panes: func() []resources.Pane { return []resources.Pane{{TmuxName: row.TmuxName, PID: info.PID}} }})
			return g.SessionHeld(row.ID)
		},
	}
}

func (s *Server) runRollover(ctx context.Context, sid string, req rolloverRequest, capGrace time.Duration) (result rolloverStatus, err error) {
	if !isPlainID(sid) {
		return result, store.ErrNotFound
	}
	row, err := s.DB.GetSession(ctx, sid)
	if err != nil {
		return result, err
	}
	if row.ArchivedAt != nil || row.Exited || homeWorkerSession(row) {
		return result, errRolloverConflict
	}
	if req.Resume && (!row.LaunchRecorded || !rolloverAgent(row) || len(row.LaunchCommand) == 0) {
		return result, errors.New("session has no resumable agent launch command")
	}
	h := s.rolloverRuntime()
	verify := req.Resume && req.Reason != "memory"
	started := h.now()
	var cyxID string
	s.rollovers.mu.Lock()
	if s.rollovers.states == nil {
		s.rollovers.states = map[string]rolloverStatus{}
	}
	if activeRollover(s.rollovers.states[sid].State) || s.rollovers.states[sid].State == "done" {
		s.rollovers.mu.Unlock()
		return result, errRolloverConflict
	}
	result = rolloverStatus{State: "asking", StartedAt: started.Unix()}
	s.rollovers.states[sid] = result
	delete(s.rollovers.actions, sid)
	s.rollovers.mu.Unlock()
	update := func(state string) {
		result.State = state
		s.rollovers.mu.Lock()
		s.rollovers.states[sid] = result
		s.rollovers.mu.Unlock()
		if verify {
			s.publishRolloverPair(sid, result, 0)
		}
	}
	if verify {
		s.publishRolloverPair(sid, result, 0)
	}
	defer func() {
		if err != nil {
			result.Error = err.Error()
			update("failed")
			if verify {
				s.failRollover(row, result, cyxID, started)
			}
		}
		s.notifyState()
	}()
	grace := time.Duration(s.ResourcePolicy(ctx).RolloverGraceSeconds) * time.Second
	if grace <= 0 {
		grace = 180 * time.Second
	}
	if capGrace > 0 && grace > capGrace {
		grace = capGrace
	}
	// Confirmation and retention have their own deadlines. The E2 budget
	// must not cancel an otherwise healthy pair after only a few minutes.
	budget := grace + 3*time.Minute
	if verify {
		budget += rolloverAckTimeout + 120*time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	project, err := s.DB.GetProject(ctx, row.ProjectID)
	if err != nil {
		return result, err
	}
	path, cyxID, err := s.Home.RolloverHandoff(s.Cfg.CyxHome, project.Path, sid, started.In(s.loc(ctx)))
	if err != nil {
		return result, err
	}
	if path == "" {
		dir := filepath.Join(s.Cfg.DataDir, "handoffs")
		if err = os.MkdirAll(dir, 0700); err != nil {
			return result, err
		}
		path = filepath.Join(dir, sid+"-"+started.Format("2006-01-02-15-04-05.000000000")+".md")
	}
	result.Handoff = path
	update("asking")
	// A retry must not mistake a previous attempt's document for a fresh reply.
	if _, statErr := os.Lstat(path); statErr == nil {
		return result, errors.New("handoff path already exists; retry in a later minute")
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return result, statErr
	}
	if !verify && h.prepareEnd != nil {
		end, prepareErr := h.prepareEnd(ctx, row)
		if prepareErr != nil {
			return result, prepareErr
		}
		h.end = func(ctx context.Context, _ store.Session) error { return end(ctx) }
	}
	heldBefore := h.held(row)
	critical := func() bool {
		total, available := h.memory()
		return req.Reason == "memory" && total > 0 && available < resources.Reserve(total)/2
	}
	if rolloverAgent(row) {
		beforeSend := h.now().Add(time.Minute)
		for row.State == session.StateWorking && !s.rolloverTurnOver(row) && h.now().Before(beforeSend) && !critical() && (h.gone == nil || !h.gone(ctx, row)) {
			if err = h.wait(ctx, time.Second); err != nil {
				return result, err
			}
			row, err = s.DB.GetSession(ctx, sid)
			if err != nil {
				return result, err
			}
		}
		before, _ := h.capture(ctx, row, 200)
		markersBefore := markerCount(before)
		// The agent writes inside its own working directory: an agent asked to
		// write anywhere else stops at its own permission prompt (measured with
		// Claude Code in acceptEdits mode) and nobody is there to answer it.
		// The panel moves the file to its place afterwards.
		draft := rolloverDraftPath(row.CWD, project.Path, sid)
		if draft != "" {
			_ = os.Remove(draft)
		}
		asked := path
		if draft != "" {
			asked = draft
		}
		if err = h.send(ctx, row, handoffPrompt(req.Reason, asked)); err != nil {
			return result, err
		}
		update("waiting")
		// Grace belongs to the reply. Spending it before the prompt would
		// end a working agent immediately after asking it to save its work.
		deadline := h.now().Add(grace)
		if err = s.waitHandoff(ctx, h, row, asked, deadline, markersBefore, critical); err != nil {
			return result, err
		}
		if verify {
			if err = s.checkHandoffSections(ctx, h, row, asked, deadline, critical); err != nil {
				return result, err
			}
		}
		if draft != "" {
			if info, statErr := os.Lstat(draft); statErr == nil && info.Mode().IsRegular() && info.Size() > 0 {
				data, copyErr := os.ReadFile(draft)
				if copyErr == nil {
					copyErr = os.WriteFile(path, data, 0644)
				}
				if copyErr == nil {
					_ = os.Remove(draft)
				} else if verify {
					return result, copyErr
				}
			}
		}
	}
	info, statErr := os.Lstat(path)
	if errors.Is(statErr, os.ErrNotExist) || statErr == nil && info.Size() == 0 {
		if err = s.fallbackHandoff(ctx, h, row, project, req.Reason, path); err != nil {
			return result, err
		}
	} else if statErr != nil {
		return result, statErr
	} else if !info.Mode().IsRegular() {
		return result, errors.New("handoff is not a regular file")
	}
	if verify {
		if _, err = os.ReadFile(path); err != nil {
			return result, err
		}
	}
	if err = s.saveRolloverScrollback(ctx, h, row); err != nil {
		return result, err
	}
	if verify {
		var next store.Session
		next, err = h.create(ctx, row)
		result.NewSessionID = next.ID
		if err != nil {
			return result, err
		}
		update("verifying")
		var kept bool
		kept, err = s.verifyRollover(ctx, h, row, next, result)
		if err != nil {
			return result, err
		}
		if kept {
			update("idle")
			return result, nil
		}
		if err = s.saveRolloverScrollback(ctx, h, row); err != nil {
			return result, err
		}
		// Prepare against the live process after confirmation. A PID captured
		// before a ten-minute wait may no longer name the same process.
		if h.prepareEnd != nil {
			var end func(context.Context) error
			end, err = h.prepareEnd(ctx, row)
			if err != nil {
				return result, err
			}
			h.end = func(ctx context.Context, _ store.Session) error { return end(ctx) }
		}
	}
	update("ending")
	if err = h.end(ctx, row); err != nil {
		return result, err
	}
	// Archiving removes this session from the governor's roster, which would
	// make a later Held read return zero even if a process had not left yet.
	freed := uint64(0)
	if after := h.held(row); after < heldBefore {
		freed = heldBefore - after
	}
	if err = s.DB.ArchiveSession(ctx, sid, "rolled over → "+path); err != nil {
		return result, err
	}
	if err = s.DB.SetSessionExit(ctx, sid, true, 0); err != nil {
		return result, err
	}
	if err = s.setSessionState(ctx, row, session.StateDone, session.SourceManual); err != nil {
		return result, err
	}
	// Even an already-done agent has a rollover event; its state did not change.
	if row.State == session.StateDone {
		s.noteTransition(row, session.StateDone, h.now())
	}
	if cyxID != "" {
		summary := fmt.Sprintf("%s; freed memory: %s; handoff: %s", rolloverReason(req.Reason), sysmon.FormatBytes(freed), path)
		_, err = s.Home.WriteExecutionReport(s.Cfg.CyxHome, cyxID, home.ExecutionReport{Key: "rollover-" + sid, File: started.In(s.loc(ctx)).Format("2006-01-02-15-04") + "-rollover-" + sid + ".md", Title: "Session rollover: " + row.Title, At: started, Summary: summary, Body: summary})
		if err != nil {
			return result, err
		}
	}
	if req.Resume && !verify {
		var next store.Session
		next, err = h.create(ctx, row)
		result.NewSessionID = next.ID
		if err != nil {
			return result, err
		}
		update("ending")
		readyBy := h.now().Add(time.Minute)
		for {
			ready, readyErr := h.ready(ctx, next)
			if readyErr != nil {
				return result, readyErr
			}
			if ready {
				break
			}
			if !h.now().Before(readyBy) {
				return result, errors.New("new agent did not become ready within 60 seconds")
			}
			if err = h.wait(ctx, time.Second); err != nil {
				return result, err
			}
		}
		if err = h.send(ctx, next, "请先阅读交接文档 "+path+"，确认理解后从“下一步”继续。"); err != nil {
			return result, err
		}
	}
	if verify {
		s.auditRollover(ctx, "rollover.released", sid, result.NewSessionID, "", "")
	}
	update("done")
	return result, nil
}

var handoffMarker = regexp.MustCompile(`(?m)^[ \t]*(?:[⏺●•>*][ \t]*)?HANDOFF-DONE[ \t]*\r?$`)
var handoffANSI = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)

func markerCount(text string) int {
	return len(handoffMarker.FindAllStringIndex(handoffANSI.ReplaceAllString(text, ""), -1))
}

func homeTail(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[len(text)-limit:]
}

func (s *Server) waitHandoff(ctx context.Context, h rolloverHooks, row store.Session, path string, deadline time.Time, markersBefore int, critical func() bool) error {
	var size int64
	var modified, stable time.Time
	for {
		now := h.now()
		if info, err := os.Lstat(path); err == nil && info.Mode().IsRegular() && info.Size() >= 200 {
			if info.Size() != size || !info.ModTime().Equal(modified) {
				size, modified, stable = info.Size(), info.ModTime(), now
			}
			if now.Sub(stable) >= 5*time.Second {
				return nil
			}
		} else {
			size, modified, stable = 0, time.Time{}, time.Time{}
		}
		if text, err := h.capture(ctx, row, 200); err == nil && markerCount(text) > markersBefore {
			return nil
		}
		if !now.Before(deadline) || critical() || h.gone != nil && h.gone(ctx, row) {
			return nil
		}
		if err := h.wait(ctx, time.Second); err != nil {
			return err
		}
	}
}

func (s *Server) fallbackHandoff(ctx context.Context, h rolloverHooks, row store.Session, project store.Project, reason, path string) error {
	data := fmt.Sprintf("---\ngenerated_by: pantheon (agent did not answer)\n---\n# Session handoff\n\nTitle: %s\nProject: %s (%s)\nCWD: %s\nLaunch command: %q\nReason: %s (%s)\n\n%s", row.Title, project.Name, project.Path, row.CWD, row.LaunchCommand, reason, rolloverReason(reason), s.handoffEvidence(ctx, h, row))
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer root.Close()
	name := filepath.Base(path)
	if info, e := root.Lstat(name); e == nil {
		if !info.Mode().IsRegular() {
			return errors.New("handoff is not a regular file")
		}
		if info.Size() > 0 {
			return nil
		}
		if err = root.Remove(name); err != nil {
			return err
		}
	}
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = file.WriteString(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	return err
}

func (s *Server) createRolloverSession(ctx context.Context, old store.Session) (store.Session, error) {
	profile, err := s.launchProfileFor(ctx, old.LaunchProfileID)
	if err != nil {
		return store.Session{}, err
	}
	env, err := s.claudeAccountEnv(ctx, old.ClaudeAccountID)
	if err != nil {
		return store.Session{}, err
	}
	dir, err := s.restoreDir(ctx, old)
	if err != nil {
		return store.Session{}, err
	}
	sid := id.New()
	row := store.Session{ID: sid, ProjectID: old.ProjectID, TmuxName: id.TmuxName(sid), Title: old.Title, Pinned: old.Pinned, CWD: dir, Cols: old.Cols, Rows: old.Rows, State: session.StateWorking, LaunchCommand: old.LaunchCommand, LaunchProfileID: old.LaunchProfileID, ClaudeAccountID: old.ClaudeAccountID}
	row, err = s.DB.CreateSession(ctx, row)
	if err != nil {
		return row, err
	}
	err = s.rolloverTerminal().Create(ctx, tmux.CreateOptions{Name: row.TmuxName, Dir: dir, Command: row.LaunchCommand, Env: store.LaunchEnv(profile, append(env, s.hookEnv(ctx, sid, row.ProjectID)...)), Width: row.Cols, Height: row.Rows})
	if err != nil {
		_ = s.DB.SetSessionExit(ctx, sid, true, store.ExitStatusVanished)
		return row, errors.New("could not launch replacement session")
	}
	if s.Manager != nil {
		_, _ = s.Manager.Attach(ctx, sid, row.TmuxName, row.Cols, row.Rows)
	}
	s.notifyState()
	return row, nil
}

// rolloverReadyQuiet is how long a fresh agent's pane must have been still.
// Long enough to outlast the redraws a TUI makes while it starts; short enough
// that the one-minute ready budget is mostly spare.
const rolloverReadyQuiet = 5 * time.Second

// rolloverSettled is readiness for a replacement no hook vouches for. Without
// hooks the detector says "working" for as long as an agent runs, so waiting
// for waiting/done timed out on every handoff on a machine without them: the
// old session was ended and the new one never received its message. What a
// starting TUI does that can be seen is draw itself and then stop. Something
// must have been drawn -- an empty pane is a process that has not started --
// and nothing since. A hook's "working" is not a guess and is not overruled.
func (s *Server) rolloverSettled(row store.Session, now time.Time) bool {
	if s.Detector == nil || row.State != session.StateWorking || row.StateSource != session.SourceHeuristic {
		return false
	}
	last := s.Detector.LastOutput(row.ID)
	return !last.IsZero() && now.Sub(last) >= rolloverReadyQuiet
}

// rolloverTurnOver lets the transcript end the wait before the prompt, the same
// way it lets a strip reach its countdown (claudeTurnOver). Waiting for the
// heuristic to say anything but "working" spent the whole minute on every
// handoff without hooks, after the boundary had already established this.
func (s *Server) rolloverTurnOver(row store.Session) bool {
	u := s.contexts.snapshot([]store.Session{row})[row.ID]
	return claudeTurnOver(chat.AgentFor(row.LaunchCommand, ""), row.State, row.StateSource, u.TurnEnded)
}

// rolloverDraftPath is where the agent is asked to write: a dot-file at the
// root of the directory it is working in (its own cwd, else the project's),
// which every agent may write without asking. Empty when neither exists.
func rolloverDraftPath(cwd, projectPath, sid string) string {
	for _, dir := range []string{cwd, projectPath} {
		if dir == "" {
			continue
		}
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return filepath.Join(dir, ".pantheon-handoff-"+sid+".md")
		}
	}
	return ""
}

func (s *Server) handoffEvidence(ctx context.Context, h rolloverHooks, row store.Session) string {
	text, err := h.capture(ctx, row, 200)
	if err != nil {
		if sb, e := s.DB.GetScrollback(ctx, row.ID); e == nil {
			text = string(sb.Content)
		} else {
			text = "Scrollback unavailable: " + err.Error()
		}
	}
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) > 200 {
		lines = lines[len(lines)-200:]
	}
	text = homeTail(strings.Join(lines, "\n"), 128<<10)
	gitText := func(args ...string) string {
		gitCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(gitCtx, "git", append([]string{"-C", row.CWD}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0")
		var data homeGitOutput
		cmd.Stdout = &data
		cmd.WaitDelay = time.Second
		if err := cmd.Run(); err != nil {
			return "Unavailable (not a repository or git failed)."
		}
		return homeTail(data.String(), 32<<10)
	}
	return fmt.Sprintf("## Last 200 lines\n\n```text\n%s\n```\n\n## git status --short\n\n```text\n%s\n```\n\n## git log --oneline -5\n\n```text\n%s\n```\n", text, gitText("status", "--short"), gitText("log", "--oneline", "-5"))
}

func (s *Server) saveRolloverScrollback(ctx context.Context, h rolloverHooks, row store.Session) error {
	// Capture before signalling: the pane's exit screen may replace the only
	// remaining copy of the agent's final output.
	text, captureErr := h.capture(ctx, row, scrollbackLines)
	if captureErr != nil {
		if _, archiveErr := s.DB.GetScrollback(ctx, row.ID); archiveErr != nil {
			return captureErr
		}
	} else if strings.TrimSpace(text) != "" {
		content, truncated := boundScrollback([]byte(text), maxScrollbackBytes)
		if err := s.DB.PutScrollback(ctx, store.Scrollback{SessionID: row.ID, CapturedAt: h.now().Unix(), Lines: scrollbackLines, Truncated: truncated, Content: content}); err != nil {
			return err
		}
	}
	return nil
}
