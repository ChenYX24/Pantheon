package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/rollover"
	"github.com/jiangmuran/vibepanel/internal/store"
)

const rolloverAckTimeout = 10 * time.Minute

var handoffAckMarker = regexp.MustCompile(`(?m)^[ \t]*(?:[⏺●•>*][ \t]*)?HANDOFF-ACK[ \t]*\r?$`)

func ackMarkerCount(text string) int {
	return len(handoffAckMarker.FindAllStringIndex(handoffANSI.ReplaceAllString(text, ""), -1))
}

func handoffAckPrompt(path string) string {
	return "[Pantheon] 你接手了上一个会话。请先阅读交接文档 " + path + "，然后：1）用一句话复述其中的“下一步”，执行 vibepanel me info set summary \"<复述>\"；2）执行 vibepanel me info set labels handoff-ack（vibepanel 命令不可用时，改为单独输出一行 HANDOFF-ACK）；3）从“下一步”继续。"
}

func missingHandoffSections(data string) []string {
	var missing []string
	for _, name := range []string{"目标", "已完成", "未完成", "下一步", "验证命令", "禁止事项"} {
		found := false
		for _, line := range strings.Split(data, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "#") && strings.Contains(line, name) {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, name)
		}
	}
	return missing
}

func (s *Server) checkHandoffSections(ctx context.Context, h rolloverHooks, row store.Session, path string, deadline time.Time, critical func() bool) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) || err == nil && info.Mode().IsRegular() && info.Size() == 0 {
		return nil // No agent document: the existing complete fallback follows.
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("handoff is not a regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	missing := missingHandoffSections(string(data))
	if len(missing) == 0 {
		return nil
	}
	before, _ := h.capture(ctx, row, 200)
	if err := h.send(ctx, row, "[Pantheon] 交接文档 "+path+" 缺少 Markdown 标题："+strings.Join(missing, "、")+"。请保留已有内容并补齐，写完后只回复 HANDOFF-DONE。"); err != nil {
		return err
	}
	// A repair gets the remainder of the original grace, not another full
	// grace period on top of an agent that already failed to answer.
	if err := s.waitHandoff(ctx, h, row, path, deadline, markerCount(before), critical); err != nil {
		return err
	}
	info, err = os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("handoff is not a regular file")
	}
	data, err = os.ReadFile(path)
	if err != nil {
		return err
	}
	missing = missingHandoffSections(string(data))
	if len(missing) == 0 {
		return nil
	}
	// The agent can still be writing here. Constrain an exchanged symlink
	// to this directory rather than appending evidence to an unrelated file.
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer root.Close()
	file, err := root.OpenFile(filepath.Base(path), os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(file, "\n\n## Pantheon fallback\n\nMissing sections: %s\n\n%s", strings.Join(missing, "、"), s.handoffEvidence(ctx, h, row))
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	return err
}

// Manual and automatic handoffs publish through the same snapshot. Keeping
// this in the primitive also makes a replacement busy before it can be due.
func (s *Server) publishRolloverPair(sid string, status rolloverStatus, endsAt int64) {
	state := rollover.State(status.State)
	switch status.State {
	case "asking", "waiting":
		state = rollover.HandingOff
	case "ending":
		return
	case "done", "idle":
		state = rollover.OK
	}
	nextState := rollover.OK
	if state == rollover.Verifying {
		nextState = rollover.Verifying
	} else if state == rollover.HandedOff {
		nextState = rollover.Confirmed
	}
	s.rollovers.mu.Lock()
	s.rollovers.states[sid] = status
	if status.NewSessionID != "" {
		next := rolloverStatus{State: "idle"}
		if nextState != rollover.OK {
			next = rolloverStatus{State: string(nextState), Handoff: status.Handoff, StartedAt: status.StartedAt}
		}
		s.rollovers.states[status.NewSessionID] = next
	}
	s.rollovers.mu.Unlock()
	a := &s.autoRollover
	a.mu.Lock()
	if a.entries == nil {
		a.entries = map[string]rollover.Memory{}
	}
	m := a.entries[sid]
	// The trigger already counted automatic/now attempts. Direct manual
	// requests join the same history once, so a failed verify cannot reset it.
	if state == rollover.HandingOff && m.State != rollover.HandingOff {
		m.Attempts = append(m.Attempts, time.Unix(status.StartedAt, 0))
	}
	m.View = rollover.View{State: state, Pct: m.Pct, NewSessionID: status.NewSessionID, EndsAt: endsAt}
	if state == rollover.Failed {
		m.Reason = status.Error
	}
	if state == rollover.OK {
		m = rollover.Finish(m, nil).Memory
		if status.State == "idle" {
			m = rollover.Cancel(m, "keep").Memory
		}
	}
	a.entries[sid] = m
	if status.NewSessionID != "" {
		next := a.entries[status.NewSessionID]
		next.View = rollover.View{State: nextState}
		if nextState != rollover.OK {
			next.Replaces = sid
		}
		next.Attempts = append([]time.Time(nil), m.Attempts...)
		a.entries[status.NewSessionID] = next
	}
	a.mu.Unlock()
	s.notifyState()
}

func (s *Server) rolloverPairAction(sid, action string) bool {
	s.rollovers.mu.Lock()
	defer s.rollovers.mu.Unlock()
	status := s.rollovers.states[sid]
	if status.NewSessionID == "" {
		return false
	}
	state := status.State
	if action == "keep" && (state == "verifying" || state == "handed_off") || action == "release" && state == "handed_off" {
		if s.rollovers.actions == nil {
			s.rollovers.actions = map[string]string{}
		}
		// A return to the old session wins over a release queued in another tab.
		if s.rollovers.actions[sid] != "keep" {
			s.rollovers.actions[sid] = action
		}
		return true
	}
	return false
}

func (s *Server) rolloverPairChoice(sid string) string {
	s.rollovers.mu.Lock()
	defer s.rollovers.mu.Unlock()
	return s.rollovers.actions[sid]
}

func (s *Server) verifyRollover(ctx context.Context, h rolloverHooks, old, next store.Session, status rolloverStatus) (bool, error) {
	keep := func(reason string) (bool, error) {
		s.auditRollover(ctx, "rollover.cancelled", old.ID, next.ID, reason, "")
		return true, nil
	}
	alive := func() (store.Session, error) {
		current, err := s.DB.GetSession(ctx, next.ID)
		if err != nil || current.Exited || current.ArchivedAt != nil || h.gone != nil && h.gone(ctx, next) {
			return current, errors.New("replacement session exited or vanished")
		}
		return current, nil
	}
	// Typing into the old session counts from the moment the replacement
	// exists, not from the ack. A person who asks the old agent for one more
	// thing while the new one is still reading is using it; counting only
	// later keystrokes released it ten minutes after the ack, mid-answer.
	pairedAt := h.now()
	typed := func() bool { return s.lastResourceInput(old.ID).After(pairedAt) }
	readyBy := h.now().Add(time.Minute)
	for {
		if s.rolloverPairChoice(old.ID) == "keep" {
			return keep("keep")
		}
		if typed() {
			return keep("input")
		}
		if _, err := alive(); err != nil {
			return false, err
		}
		ready, err := h.ready(ctx, next)
		if err != nil {
			return false, err
		}
		if ready {
			break
		}
		if !h.now().Before(readyBy) {
			return false, notAtInputBox(ctx, h, next)
		}
		if err := h.wait(ctx, time.Second); err != nil {
			return false, err
		}
	}
	// The screen is only the second way to confirm. A capture that times out
	// on a loaded machine reads as nothing on screen, not as a failure: the
	// label can still arrive, and a replacement that is really gone is
	// alive()'s to report.
	before, _ := h.capture(ctx, next, 200)
	markersBefore := ackMarkerCount(before)
	if err := h.send(ctx, next, handoffAckPrompt(status.Handoff)); err != nil {
		return false, err
	}
	ackBy := h.now().Add(rolloverAckTimeout)
	var ackAt time.Time
	for {
		if s.rolloverPairChoice(old.ID) == "keep" {
			return keep("keep")
		}
		if typed() {
			return keep("input")
		}
		current, err := alive()
		if err != nil {
			return false, err
		}
		text, _ := h.capture(ctx, next, 200)
		if slices.Contains(current.Labels, "handoff-ack") || ackMarkerCount(text) > markersBefore {
			ackAt = h.now()
			summary := []rune(current.Summary)
			if len(summary) > 200 {
				summary = summary[:200]
			}
			s.auditRollover(ctx, "rollover.handed_off", old.ID, next.ID, "", string(summary))
			break
		}
		if !h.now().Before(ackBy) {
			return false, errors.New("replacement did not confirm the handoff within 10 minutes")
		}
		if err := h.wait(ctx, time.Second); err != nil {
			return false, err
		}
	}
	policy, _, err := s.loadAutoSettings(ctx)
	if err != nil {
		return false, err
	}
	releaseAt := ackAt.Add(time.Duration(policy.KeepOldMinutes) * time.Minute)
	status.State = "handed_off"
	s.publishRolloverPair(old.ID, status, releaseAt.UnixMilli())
	decide := func(release bool) string {
		s.rollovers.mu.Lock()
		defer s.rollovers.mu.Unlock()
		if s.rollovers.actions[old.ID] == "keep" {
			return "keep"
		}
		if typed() {
			return "input"
		}
		if release {
			status.State = "ending"
			s.rollovers.states[old.ID] = status
		}
		return ""
	}
	for {
		if reason := decide(false); reason != "" {
			return keep(reason)
		}
		if _, err := alive(); err != nil {
			return false, err
		}
		if s.rolloverPairChoice(old.ID) == "release" || !h.now().Before(releaseAt) || h.alert != nil && h.alert() {
			// Input or keep may have arrived while SQLite/tmux answered. Check
			// again at the release decision, before making the route refuse keep.
			if reason := decide(true); reason != "" {
				return keep(reason)
			}
			return false, nil
		}
		if err := h.wait(ctx, time.Second); err != nil {
			return false, err
		}
	}
}

func (s *Server) auditRollover(ctx context.Context, event, sid, next, reason, summary string) {
	detail := map[string]any{"sessionId": sid}
	if next != "" {
		detail["newSessionId"] = next
	}
	if reason != "" {
		detail["reason"] = reason
	}
	if event == "rollover.handed_off" {
		detail["summary"] = summary
	}
	b, _ := json.Marshal(detail)
	s.audit(ctx, event, "", "", string(b))
}

func (s *Server) failRollover(row store.Session, status rolloverStatus, cyxID string, started time.Time) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s.auditRollover(ctx, "rollover.failed", row.ID, status.NewSessionID, status.Error, "")
	if cyxID == "" {
		return
	}
	body := fmt.Sprintf("Reason: %s\nHandoff: %s\nOld session: %s\nNew session: %s", status.Error, status.Handoff, row.ID, status.NewSessionID)
	_, err := s.Home.WriteExecutionReport(s.Cfg.CyxHome, cyxID, home.ExecutionReport{Key: "rollover-" + row.ID, File: started.In(s.loc(ctx)).Format("2006-01-02-15-04") + "-rollover-" + row.ID + ".md", Title: "Session handover needs checking: " + row.Title, At: started, NeedsUser: true, Summary: status.Error, Body: body})
	if err != nil {
		s.Log.Error("rollover failure report", "session", row.ID, "err", err)
	}
}
