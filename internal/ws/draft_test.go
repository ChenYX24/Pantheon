package ws

import (
	"context"
	"testing"
)

func TestDraftPresenceAndDisconnect(t *testing.T) {
	seen := []bool{}
	closed := ""
	c := &Conn{draftID: "connection", h: &Handler{
		Draft: func(_ context.Context, connection, sid string, hasText bool) {
			if connection != "connection" || sid != "session" {
				t.Fatal(connection, sid)
			}
			seen = append(seen, hasText)
		},
		Disconnected: func(connection string) { closed = connection },
	}}
	c.handleControl(context.Background(), ClientMessage{Type: MsgDraft, SessionID: "session"})
	if len(seen) != 0 {
		t.Fatal("absent hasText was accepted")
	}
	for _, value := range []bool{true, false} {
		c.handleControl(context.Background(), ClientMessage{Type: MsgDraft, SessionID: "session", HasText: &value})
	}
	if len(seen) != 2 || !seen[0] || seen[1] {
		t.Fatal(seen)
	}
	c.closeAll()
	if closed != "connection" {
		t.Fatal("disconnected browser retained its drafts")
	}
}
