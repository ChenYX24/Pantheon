package chat

import (
	"strings"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
)

// A notice reaches the phone whatever the session's state, with the
// choices as buttons, and a pressed choice is typed into the session.
func TestANoticeReachesThePhoneWhateverTheState(t *testing.T) {
	r := newRig(t, Capabilities{Proactive: true, Buttons: true})
	r.peer("me", store.PeerPaired, store.ModeNormal)
	row := r.session("s1", "agent", "claude", session.StateWorking)
	n := r.b.Notify(r.ctx, row, Notice{Text: "drop the old table?", Choices: []string{"drop", "keep", "a choice far too long to fit"}})
	if n != 1 {
		t.Fatalf("sent to %d contacts, want 1", n)
	}
	last := r.ad.sent[len(r.ad.sent)-1]
	if last.Card == nil || !strings.Contains(last.Card.Body, "drop the old table?") || len(last.Buttons) != 3 {
		t.Fatalf("the notice as sent: %+v", last)
	}
	if last.Buttons[2].Label != "a choice far" || !strings.HasPrefix(last.Buttons[0].Value, "reply:"+row.ID+":0:drop") {
		t.Errorf("buttons: %+v", last.Buttons)
	}
	// The press: the words typed into the session, Enter after them.
	r.press(last.Buttons[0].Value, "")
	if got := strings.Join(r.term.pasted(row.TmuxName), "\n"); !strings.Contains(got, "drop") {
		t.Errorf("the choice was not typed: %q", got)
	}
	// Bounded: an empty notice sends nothing; the level vocabulary holds.
	if r.b.Notify(r.ctx, row, Notice{Text: "   "}) != 0 {
		t.Error("an empty notice was sent")
	}
	if c := CleanNotice(Notice{Level: "loud", Text: "x"}); c.Level != "info" {
		t.Errorf("level: %q", c.Level)
	}
}

// An image reaches the phone as a photo; another file as a card with the
// link the owner opens signed in.
func TestAnAttachmentReachesThePhone(t *testing.T) {
	r := newRig(t, Capabilities{Proactive: true, Images: true})
	r.peer("me", store.PeerPaired, store.ModeNormal)
	row := r.session("s1", "agent", "claude", session.StateWorking)
	before := r.ad.images
	if n := r.b.SendAttachment(r.ctx, row, "chart.png", []byte("png bytes"), "image/png", "coverage", "https://panel.test/api/sessions/s1/attachments/chart.png"); n != 1 {
		t.Fatalf("image sent to %d", n)
	}
	if r.ad.images != before+1 {
		t.Errorf("the image was not sent as a photo: %d → %d", before, r.ad.images)
	}
	if n := r.b.SendAttachment(r.ctx, row, "report.pdf", []byte("%PDF"), "application/pdf", "", "https://panel.test/api/sessions/s1/attachments/report.pdf"); n != 1 {
		t.Fatalf("file sent to %d", n)
	}
	last := r.ad.sent[len(r.ad.sent)-1]
	if last.Card == nil || !strings.Contains(last.Card.Body, "report.pdf") || !strings.Contains(last.Card.Body, "attachments/report.pdf") {
		t.Errorf("the file card: %+v", last.Card)
	}
}
