package chat

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/jiangmuran/vibepanel/internal/store"
)

func HomeKindLabel(lang, kind string) string { return msg(lang, "home."+kind) }

// Home notifications are plain outbound text. They carry no workflow decision
// ids or buttons, so answering one cannot approve or execute project work.
func (b *Bridge) SendHomeNotification(ctx context.Context, peer, text string) error {
	p, err := b.d.DB.GetChatPeer(ctx, "feishu", peer)
	if err != nil || p.Status != store.PeerPaired {
		return errors.New("Feishu recipient is not paired")
	}
	b.mu.Lock()
	ch := b.chans["feishu"]
	b.mu.Unlock()
	if ch == nil || ch.placeholder {
		row, cfg, err := b.ReadChannel(ctx, "feishu")
		if err != nil {
			return err
		}
		if !row.Enabled {
			return errors.New("Feishu notification channel is disabled")
		}
		factory, ok := FactoryFor("feishu")
		if !ok {
			return errors.New("Feishu adapter is unavailable")
		}
		values, err := json.Marshal(cfg.Values)
		if err != nil {
			return err
		}
		adapter, err := factory.New(values, Env{HTTP: b.d.HTTP, State: cfg.State, PublicURL: b.d.PublicURL()})
		if err != nil {
			return err
		}
		// An explicit send in development must not start the bridge's inbound
		// loop. Feishu can send without Run; keep this adapter off the channel
		// map too, so no webhook can acquire it as a side effect of a notice.
		ch = &channel{kind: "feishu", ad: adapter, caps: adapter.Capabilities()}
	}
	_, err = b.send(ctx, ch, p, Outbound{Text: text})
	return err
}

// A bot webhook is a single outbound recipient, independent of the paired-chat
// adapter. Network errors must not echo its credential-bearing URL into the UI.
func SendHomeWebhook(ctx context.Context, client *http.Client, webhook, secret, text string, at time.Time) error {
	payload := map[string]any{"msg_type": "text", "content": map[string]string{"text": text}}
	if secret != "" {
		stamp := strconv.FormatInt(at.Unix(), 10)
		payload["timestamp"] = stamp
		payload["sign"] = homeWebhookSign(stamp, secret)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhook, bytes.NewReader(body))
	if err != nil {
		return errors.New("invalid Feishu webhook request")
	}
	req.Header.Set("Content-Type", "application/json")
	c := http.Client{Timeout: 15 * time.Second}
	if client != nil {
		c = *client
		c.Timeout = 15 * time.Second
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := c.Do(req)
	if err != nil {
		return errors.New("Feishu webhook request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Feishu webhook returned HTTP %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 {
		return errors.New("invalid Feishu webhook response")
	}
	var result struct {
		Code *int `json:"code"`
	}
	if json.Unmarshal(raw, &result) != nil || result.Code == nil {
		return errors.New("invalid Feishu webhook response")
	}
	if *result.Code != 0 {
		return fmt.Errorf("Feishu webhook returned code %d", *result.Code)
	}
	return nil
}

func homeWebhookSign(timestamp, secret string) string {
	mac := hmac.New(sha256.New, []byte(timestamp+"\n"+secret))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
