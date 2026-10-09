package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/store"
)

type homeWebhookTransport func(*http.Request) (*http.Response, error)

func (f homeWebhookTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestHomeNotifySettingsValidationSecretsAndFlag(t *testing.T) {
	s := newInProcessTestServer(t)
	homeFixture(t, s)
	s.Cfg.Development = true
	s.Cfg.HomeNotify = "dry_run"
	s.Cfg.HomePublicURL = "https://flag.test"
	path := "/api/home/notify-settings"
	original := homeDecode[homeNotifySettings](t, homeRequest(t, s, "GET", path, "", true), 200)
	if original.Mode != "dry_run" || original.FlagMode != "dry_run" || original.WebhookConfigured || original.Signed || original.PublicURL != "https://flag.test" {
		t.Fatal(original)
	}
	for _, url := range []string{"http://open.feishu.cn/open-apis/bot/v2/hook/token", "https://evil.test/open-apis/bot/v2/hook/token", "https://open.feishu.cn.evil.test/open-apis/bot/v2/hook/token", "https://user:pass@open.feishu.cn/open-apis/bot/v2/hook/token", "https://open.feishu.cn/open-apis/bot/v2/hook/", "https://open.feishu.cn/open-apis/bot/v2/hook/token?x=1", "https://open.feishu.cn:444/open-apis/bot/v2/hook/token", "https://open.feishu.cn/open-apis/bot/v2/hook/%2e%2e"} {
		data, _ := json.Marshal(map[string]string{"webhookUrl": url})
		homeDecode[map[string]any](t, homeRequest(t, s, "PUT", path, string(data), true), 400)
	}
	homeDecode[map[string]any](t, homeRequest(t, s, "PUT", path, `{"mode":"bad"}`, true), 400)
	homeDecode[map[string]any](t, homeRequest(t, s, "PUT", path, `{"publicUrl":"javascript:alert(1)"}`, true), 400)
	saved := homeRequest(t, s, "PUT", path, `{"webhookUrl":"https://open.feishu.cn/open-apis/bot/v2/hook/private-token","secret":"private-signing-secret","mode":"send","publicUrl":"https://runtime.test"}`, true)
	settings := homeDecode[homeNotifySettings](t, saved, 200)
	if !settings.WebhookConfigured || !settings.Signed || settings.Mode != "send" || settings.PublicURL != "https://runtime.test" {
		t.Fatal(settings)
	}
	raw, err := s.DB.GetSetting(context.Background(), homeNotifySetting, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{raw, saved.Body.String(), homeRequest(t, s, "GET", path, "", true).Body.String()} {
		for _, secret := range []string{"private-token", "private-signing-secret", "open.feishu.cn"} {
			if strings.Contains(text, secret) {
				t.Fatal("secret leaked")
			}
		}
	}
	calls := 0
	s.homeNotifications.webhookHTTP = &http.Client{Transport: homeWebhookTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://open.feishu.cn/open-apis/bot/v2/hook/private-token" {
			t.Error("webhook not recovered")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["msg_type"] != "text" || body["sign"] == nil || body["content"].(map[string]any)["text"] != "[Pantheon] 测试通知" {
			t.Error("test payload")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":0}`)), Header: http.Header{}}, nil
	})}
	tested := homeDecode[map[string]any](t, homeRequest(t, s, "POST", path+"/test", `{}`, true), 200)
	if tested["ok"] != true || calls != 1 {
		t.Fatal(tested, calls)
	}
	kept := homeDecode[homeNotifySettings](t, homeRequest(t, s, "PUT", path, `{"mode":"dry_run"}`, true), 200)
	if !kept.WebhookConfigured || !kept.Signed {
		t.Fatal("omitted fields cleared")
	}
	s.Cfg.HomeNotify = "off"
	homeDecode[map[string]any](t, homeRequest(t, s, "PUT", path, `{"mode":"send"}`, true), 403)
	cleared := homeDecode[homeNotifySettings](t, homeRequest(t, s, "PUT", path, `{"webhookUrl":"","secret":"","publicUrl":""}`, true), 200)
	if cleared.WebhookConfigured || cleared.Signed || cleared.PublicURL != "" {
		t.Fatal(cleared)
	}
	missing := homeDecode[map[string]any](t, homeRequest(t, s, "POST", path+"/test", `{}`, true), 200)
	if missing["ok"] != false || calls != 1 {
		t.Fatal(missing)
	}
	if !validHomeWebhook("https://open.larksuite.com/open-apis/bot/v2/hook/a-b_c") {
		t.Fatal("Lark rejected")
	}
}

func TestHomeWebhookRecipientNeverReplaysDryRunOrBaseline(t *testing.T) {
	s := newInProcessTestServer(t)
	project := homeFixture(t, s)
	s.Cfg.HomeNotify = "dry_run"
	ctx := context.Background()
	now := time.Now()
	path := filepath.Join(project, "ACTIVE_CONTEXT.md")
	homePut(t, path, "- **Blockers**: baseline\n")
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	homePut(t, path, "- **Blockers**: dry run\n")
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	homeDecode[homeNotifySettings](t, homeRequest(t, s, "PUT", "/api/home/notify-settings", `{"mode":"send","webhookUrl":"https://open.feishu.cn/open-apis/bot/v2/hook/fixture","publicUrl":"https://override.test"}`, true), 200)
	if err := s.DB.PutChatPeer(ctx, store.ChatPeer{Channel: "feishu", PeerID: "owner", Status: store.PeerPaired, Mode: store.ModeNormal}); err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	s.homeNotifications.send = func(_ context.Context, n store.HomeDelivery) error {
		seen[n.Channel]++
		if n.Channel == "feishu_webhook" && n.Peer != "webhook" {
			t.Error("wrong webhook peer")
		}
		if !strings.Contains(n.Text, "https://override.test") {
			t.Error("flag URL won")
		}
		return nil
	}
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 0 {
		t.Fatal("old rows replayed", seen)
	}
	homePut(t, path, "- **Blockers**: newly pending\n")
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	if seen["feishu"] != 1 || seen["feishu_webhook"] != 1 {
		t.Fatal(seen)
	}
	if err := s.homeNotificationTick(ctx, now); err != nil {
		t.Fatal(err)
	}
	if seen["feishu_webhook"] != 1 {
		t.Fatal("dedup failed")
	}
}

func TestHomePlanningAllowListExactMethods(t *testing.T) {
	routes := map[string][]string{
		"/api/home": {"GET"}, "/api/home/models": {"GET"}, "/api/home/tasks": {"GET"}, "/api/home/fields": {"GET", "PUT"},
		"/api/home/notifications": {"GET"}, "/api/home/notify-settings": {"GET", "PUT"}, "/api/home/notify-settings/test": {"POST"},
		"/api/home/projects/demo": {"GET"}, "/api/home/projects/demo/meta": {"PATCH"}, "/api/home/projects/demo/tasks": {"POST"}, "/api/home/projects/demo/tasks/A2": {"PATCH"},
		"/api/home/projects/demo/discussion": {"GET", "POST"}, "/api/home/projects/demo/discussion/message/retry": {"POST"},
		"/api/home/projects/demo/threads": {"GET", "POST"}, "/api/home/projects/demo/threads/thread": {"PATCH", "DELETE"}, "/api/home/projects/demo/reports/q.md/reply": {"POST"},
	}
	for path, allowed := range routes {
		for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"} {
			want := false
			for _, m := range allowed {
				want = want || m == method
			}
			if got := homePlanningRoute(method, path); got != want {
				t.Errorf("%s %s = %v", method, path, got)
			}
			if homePlanningRoute(method, path+"/extra/extra/extra") {
				t.Errorf("extra route: %s %s", method, path)
			}
		}
	}
}
