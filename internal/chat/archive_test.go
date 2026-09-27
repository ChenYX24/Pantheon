package chat

import (
	"fmt"
	"strings"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
)

// hiddenSession makes a session in a project of its own and archives that
// project.
func (r *rig) hiddenSession(id, title, launch string, st session.State) {
	r.t.Helper()
	if _, err := r.db.CreateProject(r.ctx, "p_hidden", "hidden", r.t.TempDir()); err != nil {
		r.t.Fatal(err)
	}
	if _, err := r.db.CreateSession(r.ctx, store.Session{
		ID: id, ProjectID: "p_hidden", TmuxName: "vp_" + id, Title: title, State: st,
		LaunchCommand: []string{launch}, LaunchRecorded: true, Command: launch,
	}); err != nil {
		r.t.Fatal(err)
	}
	if err := r.db.ArchiveProject(r.ctx, "p_hidden", false); err != nil {
		r.t.Fatal(err)
	}
}

// A phone's list is the sidebar's: a session in an archived project is not in
// it, whatever state it is in.
func TestAPhoneDoesNotListAnArchivedProjectsSessions(t *testing.T) {
	r := newRig(t, Capabilities{Proactive: true})
	r.peer("me", store.PeerPaired, store.ModeNormal)
	r.hiddenSession("s1", "hidden agent", "claude", session.StateWaiting)
	r.session("s2", "shown agent", "codex", session.StateDone)
	r.say("me", "list")
	if l := r.ad.last(); strings.Contains(l, "hidden agent") || !strings.Contains(l, "shown agent") {
		t.Fatalf("list: %q", l)
	}
}

// Where a bare reply goes is decided among the candidates, so a hidden session
// waiting beside a visible one must not make "y" ambiguous -- or, worse, be
// the one it lands on.
func TestABareReplyDoesNotConsiderAnArchivedProjectsSessions(t *testing.T) {
	r := newRig(t, Capabilities{Proactive: true})
	r.peer("me", store.PeerPaired, store.ModeNormal)
	r.hiddenSession("s1", "hidden agent", "claude", session.StateWaiting)
	r.session("s2", "shown agent", "claude", session.StateWaiting)
	r.say("me", "y")
	h2, _ := r.db.ChatHandle(r.ctx, "s2")
	if l := r.ad.last(); !strings.Contains(l, fmt.Sprintf("[%d]", h2)) || strings.Contains(l, "几个") {
		t.Fatalf("a bare reply with one visible session waiting: %q", l)
	}
}
