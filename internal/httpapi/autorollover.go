package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/chat"
	"github.com/jiangmuran/vibepanel/internal/rollover"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/tmux"
)

const autoNeverKey = "rollover.auto.never"

type autoRolloverState struct {
	mu         sync.Mutex
	entries    map[string]rollover.Memory
	drafts     map[string]map[string]bool
	background map[string]bool
	now        func() time.Time
	// One observation worker, independently of the long-running handoff. A
	// slow settings read must not hold up the tmux poller or spawn a backlog.
	poll   sync.Mutex
	audits sync.WaitGroup
	// Serialises settings loads, read-modify-writes, and pruning. The cached
	// maps are immutable once published, so readers may keep their copy.
	write  sync.Mutex
	policy *rollover.Policy
	never  map[string]bool
	// The single execution seam that R3 replaces; tests use no live panes.
	run func(context.Context, string) (rolloverStatus, error)
}

func (a *autoRolloverState) clock() time.Time {
	if a.now != nil {
		return a.now()
	}
	return time.Now()
}

func (s *Server) autoRolloverAllowed() bool {
	return !s.Cfg.PlanningOnly && (!s.Cfg.Development || s.Cfg.DevelopmentTerminal && !s.Cfg.WorkflowExecute)
}

func (s *Server) loadAutoSettings(ctx context.Context) (rollover.Policy, map[string]bool, error) {
	s.autoRollover.write.Lock()
	defer s.autoRollover.write.Unlock()
	return s.loadAutoSettingsLocked(ctx)
}

func (s *Server) loadAutoSettingsLocked(ctx context.Context) (rollover.Policy, map[string]bool, error) {
	a := &s.autoRollover
	if a.policy != nil {
		return *a.policy, a.never, nil
	}
	p := rollover.DefaultPolicy()
	for name, dst := range autoPolicyFields(&p) {
		fallback, _ := json.Marshal(dst)
		raw, err := s.DB.GetSetting(ctx, "rollover.auto."+name, string(fallback))
		if err != nil {
			return rollover.Policy{}, nil, err
		}
		if strings.TrimSpace(raw) == "null" || json.Unmarshal([]byte(raw), dst) != nil {
			return rollover.Policy{}, nil, fmt.Errorf("invalid stored rollover.auto.%s", name)
		}
	}
	if err := p.Validate(); err != nil {
		return rollover.Policy{}, nil, err
	}
	raw, err := s.DB.GetSetting(ctx, autoNeverKey, "{}")
	if err != nil {
		return rollover.Policy{}, nil, err
	}
	var stored map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &stored); err != nil || stored == nil {
		return rollover.Policy{}, nil, errors.New("invalid stored rollover.auto.never")
	}
	never := map[string]bool{}
	for id, value := range stored {
		var off bool
		if strings.TrimSpace(string(value)) == "null" || json.Unmarshal(value, &off) != nil {
			return rollover.Policy{}, nil, errors.New("invalid stored rollover.auto.never")
		}
		if off {
			never[id] = true
		}
	}
	// Failed reads and corrupt values never become an enabled default.
	a.policy, a.never = &p, never
	return p, never, nil
}

func autoPolicyFields(p *rollover.Policy) map[string]any {
	return map[string]any{
		"enabled": &p.Enabled, "thresholdPct": &p.ThresholdPct,
		"countdownSeconds": &p.CountdownSeconds, "keepOldMinutes": &p.KeepOldMinutes,
		"idleInputSeconds": &p.IdleInputSeconds,
	}
}

func (s *Server) handleAutoRolloverPolicy(w http.ResponseWriter, r *http.Request) {
	p, _, err := s.loadAutoSettings(r.Context())
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "the stored rollover policy could not be read")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handlePutAutoRolloverPolicy(w http.ResponseWriter, r *http.Request) {
	a := &s.autoRollover
	a.write.Lock()
	defer a.write.Unlock()
	p, _, err := s.loadAutoSettingsLocked(r.Context())
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "the stored rollover policy could not be read; nothing was saved")
		return
	}
	var changes map[string]json.RawMessage
	if !decode(w, r, &changes) {
		return
	}
	if changes == nil {
		writeErr(w, http.StatusBadRequest, "rollover policy must be an object")
		return
	}
	destinations := autoPolicyFields(&p)
	for key, raw := range changes {
		dst, known := destinations[key]
		if !known || strings.TrimSpace(string(raw)) == "null" || json.Unmarshal(raw, dst) != nil {
			writeErr(w, http.StatusBadRequest, "unknown or invalid rollover policy field "+key)
			return
		}
	}
	if err := p.Validate(); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	data, _ := json.Marshal(p)
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(data, &fields)
	values := map[string]string{}
	for key, value := range fields {
		values["rollover.auto."+key] = string(value)
	}
	if err := s.DB.SetSettings(r.Context(), values); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	a.policy = &p
	if !p.Enabled {
		s.cancelAutoRollovers("disabled")
	}
	u, _ := currentUserFrom(r)
	s.audit(r.Context(), "rollover.policy", u.Username, s.clientIP(r), string(data))
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) pruneAutoNever(ctx context.Context, rows []store.Session) error {
	a := &s.autoRollover
	a.write.Lock()
	defer a.write.Unlock()
	_, never, err := s.loadAutoSettingsLocked(ctx)
	if err != nil || len(never) == 0 {
		return err
	}
	keep := map[string]bool{}
	for _, row := range rows {
		if never[row.ID] {
			keep[row.ID] = true
		}
	}
	if len(keep) == len(never) {
		return nil
	}
	b, _ := json.Marshal(keep)
	if err := s.DB.SetSetting(ctx, autoNeverKey, string(b)); err != nil {
		return err
	}
	a.never = keep
	return nil
}

func (s *Server) setAutoNever(ctx context.Context, sid string) error {
	a := &s.autoRollover
	a.write.Lock()
	defer a.write.Unlock()
	_, never, err := s.loadAutoSettingsLocked(ctx)
	if err != nil {
		return err
	}
	copy := map[string]bool{}
	for id, value := range never {
		copy[id] = value
	}
	copy[sid] = true
	b, _ := json.Marshal(copy)
	if err := s.DB.SetSetting(ctx, autoNeverKey, string(b)); err != nil {
		return err
	}
	a.never = copy
	return nil
}

func (s *Server) autoObservation(row store.Session, never bool) rollover.Observation {
	u := s.contexts.snapshot([]store.Session{row})[row.ID]
	o := rollover.Observation{
		Recorded: row.LaunchRecorded && len(row.LaunchCommand) > 0,
		Agent:    chat.AgentFor(row.LaunchCommand, ""), Scratch: row.Scratch,
		Archived: row.ArchivedAt != nil, Exited: row.Exited, HomeWorker: homeWorkerSession(row),
		Used: u.Used, Window: u.Window, Done: row.State == session.StateDone, TurnEnded: u.TurnEnded,
		HookBacked: row.StateSource == session.SourceHook, LastInput: s.lastResourceInput(row.ID),
		Never: never, Busy: s.RollingOver(row.ID),
		QuietSince: time.Unix(row.StateChangedAt, 0),
	}
	// Memory pressure has its own priority and countdown. Do not start a
	// context handoff while the governor is asking what to free.
	if s.Resources != nil && s.Resources.Alert() != nil {
		o.Busy = true
	}
	for _, id := range s.frozenNow() {
		if id == row.ID {
			o.Busy = true
		}
	}
	return o
}

func (s *Server) stepAutoRollover(sid string, o rollover.Observation, p rollover.Policy) rollover.Result {
	a := &s.autoRollover
	// A preference saved while this poll was reading its rows must win before
	// the countdown can commit. The lock order is settings, state, then input.
	a.write.Lock()
	defer a.write.Unlock()
	if a.policy != nil {
		p, o.Never = *a.policy, a.never[sid]
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.entries == nil {
		a.entries = map[string]rollover.Memory{}
	}
	m := a.entries[sid]
	// Requests and hooks can mark due, but only a fresh poll may advance a
	// boundary or finish a countdown. This also makes repeated signals inert.
	if (o.Now || o.PreCompact) && m.State != "" && m.State != rollover.OK && m.State != rollover.Failed {
		return rollover.Result{Memory: m}
	}
	for _, drafts := range a.drafts {
		o.Draft = o.Draft || drafts[sid]
	}
	o.Background = a.background[sid]
	// Input may arrive while the worker reads SQLite or context usage.
	o.LastInput = s.lastResourceInput(sid)
	now := a.clock()
	if s.Detector != nil && o.Eligible() {
		st, src := s.Detector.Evaluate(sid, session.Observation{Dead: o.Exited}, now)
		// Codex log readings also use SourceHook in the detector. Without an
		// actual hook report, keep the conservative two-minute quiet gate.
		o.Done, o.HookBacked = st == session.StateDone, src == session.SourceHook && !s.Detector.LastHook(sid).IsZero()
		// Without hooks the detector can only answer "working" for a Claude
		// that is sitting at its prompt: the process is there, so the
		// heuristic says so, and a handoff could never reach its countdown.
		// The transcript knows better. Only the heuristic's guess is
		// overruled -- never a hook's word, and never a bell, which means the
		// agent is asking for the person.
		if !o.Done && claudeTurnOver(o.Agent, st, src, o.TurnEnded) {
			o.Done = true
		}
		if last := s.Detector.LastOutput(sid); last.After(o.QuietSince) {
			o.QuietSince = last
		}
	}
	result := rollover.Step(m, o, p, now)
	a.entries[sid] = result.Memory
	return result
}

// claudeTurnOver is the transcript overruling the heuristic's "working" for a
// Claude whose turn has ended. Only that guess: a hook's word and a bell stand.
func claudeTurnOver(agent string, st session.State, src session.Source, turnEnded bool) bool {
	return turnEnded && agent == "claude" && st == session.StateWorking && src == session.SourceHeuristic
}

func (s *Server) queueAutoRollovers(ctx context.Context, rows []store.Session, panes map[string]tmux.Info) {
	if !s.autoRolloverAllowed() || !s.autoRollover.poll.TryLock() {
		return
	}
	go func() {
		defer s.autoRollover.poll.Unlock()
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := s.refreshAutoRollovers(ctx, rows, panes); err != nil {
			s.Log.Debug("automatic rollover observation", "err", err)
		}
	}()
}

func (s *Server) refreshAutoRollovers(ctx context.Context, rows []store.Session, panes map[string]tmux.Info) error {
	p, never, err := s.loadAutoSettings(ctx)
	if err != nil {
		return err
	}
	archived, err := s.DB.ListArchivedProjects(ctx)
	if err != nil {
		return err
	}
	hidden := map[string]bool{}
	for _, project := range archived {
		hidden[project.ID] = true
	}
	keep := map[string]bool{}
	for _, row := range rows {
		keep[row.ID] = true
		o := s.autoObservation(row, never[row.ID])
		pane, live := panes[row.TmuxName]
		o.Exited = o.Exited || !live || pane.Dead
		o.Archived = o.Archived || hidden[row.ProjectID]
		result := s.stepAutoRollover(row.ID, o, p)
		s.emitAutoRollover(ctx, row.ID, result)
		if result.Start {
			go s.executeAutoRollover(row.ID)
		}
	}
	a := &s.autoRollover
	a.mu.Lock()
	for id := range a.entries {
		if !keep[id] {
			delete(a.entries, id)
			delete(a.background, id)
		}
	}
	for _, drafts := range a.drafts {
		for id := range drafts {
			if !keep[id] {
				delete(drafts, id)
			}
		}
	}
	a.mu.Unlock()
	return s.pruneAutoNever(ctx, rows)
}

func (s *Server) executeAutoRollover(sid string) {
	ctx := context.Background()
	a := &s.autoRollover
	// The prompt and the report both name the reason, and a click read as
	// "the session ran too long" to the agent being asked to stop.
	a.mu.Lock()
	reason := "long"
	if a.entries[sid].Reason == "now" {
		reason = "manual"
	}
	a.mu.Unlock()
	run := a.run
	if run == nil {
		run = func(ctx context.Context, sid string) (rolloverStatus, error) {
			return s.runRollover(ctx, sid, rolloverRequest{Reason: reason, Resume: true}, 0)
		}
	}
	status, err := run(ctx, sid)
	a.mu.Lock()
	result := rollover.Finish(a.entries[sid], err)
	a.entries[sid] = result.Memory
	// A replacement is a new row, but must not reset the rolling 24h cap.
	if status.NewSessionID != "" {
		next := a.entries[status.NewSessionID]
		next.Attempts = append([]time.Time(nil), result.Memory.Attempts...)
		a.entries[status.NewSessionID] = next
	}
	a.mu.Unlock()
	s.emitAutoRollover(ctx, sid, result)
	s.notifyState()
}

func (s *Server) emitAutoRollover(ctx context.Context, sid string, result rollover.Result) {
	for _, event := range result.Events {
		b, _ := json.Marshal(struct {
			SessionID string `json:"sessionId"`
			Pct       int    `json:"pct"`
			Reason    string `json:"reason"`
		}{sid, event.Pct, event.Reason})
		switch event.State {
		case rollover.Due:
			s.audit(ctx, "rollover.due", "", "", string(b))
		case rollover.Countdown:
			s.audit(ctx, "rollover.countdown", "", "", string(b))
		case rollover.Cancelled:
			s.audit(ctx, "rollover.cancelled", "", "", string(b))
		case rollover.Failed:
			s.audit(ctx, "rollover.failed", "", "", string(b))
		}
	}
	if len(result.Events) > 0 || result.Changed {
		s.notifyState()
	}
}

func (s *Server) cancelAutoRollover(sid, reason string, countdownOnly bool) bool {
	a := &s.autoRollover
	a.mu.Lock()
	m := a.entries[sid]
	if m.State == rollover.HandingOff {
		a.mu.Unlock()
		return false
	}
	if countdownOnly && m.State != rollover.Countdown {
		a.mu.Unlock()
		return true
	}
	if a.entries == nil {
		a.entries = map[string]rollover.Memory{}
	}
	result := rollover.Cancel(m, reason)
	if reason == "disabled" {
		result = rollover.Suspend(m, reason)
	}
	a.entries[sid] = result.Memory
	a.mu.Unlock()
	s.notifyState()
	// Keystrokes must reach the PTY even if the audit store is slow.
	a.audits.Add(1)
	go func() {
		defer a.audits.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.emitAutoRollover(ctx, sid, result)
	}()
	return true
}

func (s *Server) cancelAutoRollovers(reason string) {
	a := &s.autoRollover
	a.mu.Lock()
	var ids []string
	for id, m := range a.entries {
		if m.State == rollover.Due || m.State == rollover.Countdown {
			ids = append(ids, id)
		}
	}
	a.mu.Unlock()
	for _, id := range ids {
		s.cancelAutoRollover(id, reason, false)
	}
}

func (s *Server) handleAutoRollover(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
	}
	if !decode(w, r, &req) {
		return
	}
	switch req.Action {
	case "now", "later", "never", "cancel":
	default:
		writeErr(w, http.StatusBadRequest, "action must be now, later, never or cancel")
		return
	}
	row, err := s.DB.GetSession(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	a := &s.autoRollover
	a.mu.Lock()
	active := a.entries[row.ID].State == rollover.HandingOff
	counting := a.entries[row.ID].State == rollover.Countdown
	a.mu.Unlock()
	if active || s.RollingOver(row.ID) {
		writeErr(w, http.StatusConflict, "handoff has already started")
		return
	}
	if req.Action == "never" {
		if err := s.setAutoNever(r.Context(), row.ID); err != nil {
			writeErr(w, http.StatusServiceUnavailable, "the session preference could not be saved")
			return
		}
	}
	if req.Action != "now" {
		if !s.cancelAutoRollover(row.ID, req.Action, false) {
			writeErr(w, http.StatusConflict, "handoff has already started")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if counting {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	p, never, err := s.loadAutoSettings(r.Context())
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "the stored rollover policy could not be read")
		return
	}
	o := s.autoObservation(row, never[row.ID])
	hidden, err := s.DB.SessionHidden(r.Context(), row.ID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	// The switch and the session's "never" hold back automatic triggers, not
	// this request: it is the person deciding. rollover.Step applies the same
	// rule on every later poll.
	if hidden || !o.Eligible() || o.Busy {
		writeErr(w, http.StatusConflict, "session is not eligible for automatic rollover")
		return
	}
	o.Now = true
	result := s.stepAutoRollover(row.ID, o, p)
	if result.Memory.State != rollover.Due && result.Memory.State != rollover.Countdown {
		writeErr(w, http.StatusConflict, "session is not eligible for automatic rollover")
		return
	}
	s.emitAutoRollover(r.Context(), row.ID, result)
	// Now requests the next safe boundary; it never skips the countdown.
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) signalAutoCompaction(ctx context.Context, row store.Session) {
	if !s.autoRolloverAllowed() || chat.AgentFor(row.LaunchCommand, "") != "claude" {
		return
	}
	s.autoRollover.mu.Lock()
	state := s.autoRollover.entries[row.ID].State
	s.autoRollover.mu.Unlock()
	if state == rollover.Due || state == rollover.Countdown || state == rollover.HandingOff {
		return
	}
	p, never, err := s.loadAutoSettings(ctx)
	if err != nil {
		return
	}
	hidden, err := s.DB.SessionHidden(ctx, row.ID)
	if err != nil || hidden {
		return
	}
	o := s.autoObservation(row, never[row.ID])
	o.PreCompact = true
	result := s.stepAutoRollover(row.ID, o, p)
	s.emitAutoRollover(ctx, row.ID, result)
}

func (s *Server) noteAutoBackground(sid string, running bool) {
	a := &s.autoRollover
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.background == nil {
		a.background = map[string]bool{}
	}
	if running {
		a.background[sid] = true
	} else {
		delete(a.background, sid)
	}
}

func (s *Server) noteAutoDraft(ctx context.Context, connection, sid string, hasText bool) {
	if !isPlainID(sid) {
		return
	}
	if _, err := s.DB.GetSession(ctx, sid); err != nil {
		return
	}
	a := &s.autoRollover
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.drafts == nil {
		a.drafts = map[string]map[string]bool{}
	}
	if hasText {
		if a.drafts[connection] == nil {
			a.drafts[connection] = map[string]bool{}
		}
		a.drafts[connection][sid] = true
	} else {
		delete(a.drafts[connection], sid)
	}
}

func (s *Server) forgetAutoDrafts(connection string) {
	s.autoRollover.mu.Lock()
	delete(s.autoRollover.drafts, connection)
	s.autoRollover.mu.Unlock()
}

func (s *Server) autoRolloverSnapshot(rows []store.Session) map[string]rollover.View {
	a := &s.autoRollover
	a.mu.Lock()
	defer a.mu.Unlock()
	out := map[string]rollover.View{}
	for _, row := range rows {
		m := a.entries[row.ID]
		if m.State != "" && m.State != rollover.OK && !row.Scratch && !row.Exited && row.ArchivedAt == nil {
			out[row.ID] = m.View
		}
	}
	return out
}
