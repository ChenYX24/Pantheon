package ws

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// What a browser's terminal sends on its own is not somebody typing.
//
// Handler.Input keeps a session's CPU, cancels an automatic handoff's
// countdown, and keeps a handed-off session from being released. It used to
// be called for every input frame, so a focus report -- xterm sends one when
// its terminal is clicked or loses focus -- did all three, and is the one path
// found that explains a handed-off session on /dev kept for "input" with
// nothing on its screen typed. Keystrokes are reported by the Live instead
// (TestALiveCallsOnKeyForKeysAndNotEscapeSequences). A paste does not go
// through Live.Write, so it is the one thing reported from here.
func TestATerminalsOwnTrafficIsNotReportedAsInput(t *testing.T) {
	s := serveSession(t, "vp_ws_input", "true")
	var mu sync.Mutex
	var got []string
	s.handler.Input = func(id string) {
		mu.Lock()
		defer mu.Unlock()
		got = append(got, id)
	}
	reported := func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), got...)
	}

	v := dialViewer(t, s, "input-a")
	v.send(map[string]any{"t": MsgSubscribe, "sessionId": "s1", "cols": 80, "rows": 24})
	ref := v.await(MsgSubscribed).Ref
	for _, p := range []string{
		"\x1b[I", "\x1b[O", // focus in and out
		"\x1b[?62;22c",                     // an answer to a device attributes query
		"\x1b]11;rgb:0000/0000/0000\x1b\\", // an answer to a background colour query
		"\x1b[<65;10;5M",                   // a wheel report
	} {
		if err := v.conn.Write(context.Background(), websocket.MessageBinary, EncodeData(ref, []byte(p))); err != nil {
			t.Fatalf("write %q: %v", p, err)
		}
	}
	// The positive control, and the barrier: one socket's messages are handled
	// in order, so once the paste is reported every frame before it has been.
	v.send(map[string]any{"t": MsgPaste, "sessionId": "s1", "text": "hello"})
	for deadline := time.Now().Add(5 * time.Second); len(reported()) == 0; time.Sleep(20 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("a paste was never reported as input; nothing above means anything")
		}
	}
	if r := reported(); len(r) != 1 || r[0] != "s1" {
		t.Errorf("reported as input: %q, want only the paste", r)
	}
}
