package chat

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/store"
)

func TestHomeNotificationUsesPlainFeishuText(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := newFake("feishu", Capabilities{Buttons: true, Proactive: true})
	b := New(Deps{DB: db})
	b.chans["feishu"] = &channel{kind: "feishu", ad: adapter, caps: adapter.Capabilities()}
	if err = db.PutChatPeer(ctx, store.ChatPeer{Channel: "feishu", PeerID: "owner", Status: store.PeerPaired, Mode: store.ModeNormal}); err != nil {
		t.Fatal(err)
	}
	if err = b.SendHomeNotification(ctx, "owner", "[Pantheon] test"); err != nil {
		t.Fatal(err)
	}
	if adapter.count() != 1 || adapter.last() != "[Pantheon] test" {
		t.Fatal("not plain text", adapter.last())
	}
	if adapter.sent[0].Card != nil || len(adapter.sent[0].Buttons) != 0 {
		t.Fatal("home notification carries interactive content")
	}
	if err = b.SendHomeNotification(ctx, "stranger", "no"); err == nil {
		t.Fatal("unpaired send")
	}
}

func TestHomeNotificationLabelsUseBothChatLanguages(t *testing.T) {
	for _, kind := range []string{"question", "awaiting_approval", "blocked", "awaiting_review", "session_waiting", "session_rollover"} {
		zh, en := HomeKindLabel("zh", kind), HomeKindLabel("en", kind)
		if zh == "" || en == "" || zh == en || en == "home."+kind {
			t.Fatal("missing label", kind)
		}
	}
}
