package chat_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/chat"
	_ "github.com/jiangmuran/vibepanel/internal/chat/feishu"
	"github.com/jiangmuran/vibepanel/internal/secret"
	"github.com/jiangmuran/vibepanel/internal/store"
)

type homeTransport func(*http.Request) (*http.Response, error)

func (f homeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestHomeOutboundFeishuNeedsNoInboundBridge(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	db, err := store.Open(ctx, filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	box, err := secret.Open(filepath.Join(dir, "key"))
	if err != nil {
		t.Fatal(err)
	}
	config, _ := json.Marshal(chat.ChannelConfig{Values: map[string]string{"app_id": "fixture", "app_secret": "fixture", "verification_token": "fixture"}})
	row := store.ChatChannel{Kind: "feishu", Enabled: true, ConfigEnc: box.Seal(config, "chat:feishu")}
	if err := db.PutChatChannel(ctx, row); err != nil {
		t.Fatal(err)
	}
	if err := db.PutChatPeer(ctx, store.ChatPeer{Channel: "feishu", PeerID: "owner", Status: store.PeerPaired, Mode: store.ModeNormal}); err != nil {
		t.Fatal(err)
	}
	sends, tokens := 0, 0
	client := &http.Client{Transport: homeTransport(func(r *http.Request) (*http.Response, error) {
		body := `{"code":0,"data":{"message_id":"sent"}}`
		switch r.URL.Path {
		case "/open-apis/auth/v3/tenant_access_token/internal":
			tokens++
			body = `{"code":0,"tenant_access_token":"fixture-token","expire":7200}`
		case "/open-apis/im/v1/messages":
			sends++
			var message map[string]string
			if err := json.NewDecoder(r.Body).Decode(&message); err != nil {
				t.Fatal(err)
			}
			if message["msg_type"] != "text" || message["receive_id"] != "owner" || !strings.Contains(message["content"], "[Pantheon]") {
				t.Fatal(message)
			}
		default:
			t.Fatal("unexpected adapter request", r.URL.Path)
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	b := chat.New(chat.Deps{DB: db, Box: box, HTTP: client})
	if err := b.SendHomeNotification(ctx, "owner", "[Pantheon] ready"); err != nil {
		t.Fatal(err)
	}
	if sends != 1 || tokens != 1 || b.Webhook("feishu") != nil {
		t.Fatal("send started an inbound bridge")
	}
	row.Enabled = false
	if err := db.PutChatChannel(ctx, row); err != nil {
		t.Fatal(err)
	}
	if err := b.SendHomeNotification(ctx, "owner", "[Pantheon] refused"); err == nil || sends != 1 || tokens != 1 {
		t.Fatal("disabled channel sent")
	}
}
