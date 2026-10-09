package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/jiangmuran/vibepanel/internal/chat"
)

const homeNotifySetting = "home_notify"
const homeWebhookContext = "home-notify:webhook"
const homeSecretContext = "home-notify:secret"

type homeNotifyRecord struct {
	Mode      *string `json:"mode,omitempty"`
	PublicURL *string `json:"publicUrl,omitempty"`
	Webhook   []byte  `json:"webhook,omitempty"`
	Secret    []byte  `json:"secret,omitempty"`
}

type homeNotifySettings struct {
	Mode              string `json:"mode"`
	FlagMode          string `json:"flagMode"`
	WebhookConfigured bool   `json:"webhookConfigured"`
	Signed            bool   `json:"signed"`
	PublicURL         string `json:"publicUrl"`
}

func (s *Server) readHomeNotify(ctx context.Context) (homeNotifyRecord, error) {
	var record homeNotifyRecord
	raw, err := s.DB.GetSetting(ctx, homeNotifySetting, "")
	if err != nil || raw == "" {
		return record, err
	}
	err = json.Unmarshal([]byte(raw), &record)
	return record, err
}

func (s *Server) homeNotifyView(record homeNotifyRecord) homeNotifySettings {
	mode, publicURL := s.homeNotifyMode(), s.Cfg.HomePublicURL
	if record.Mode != nil {
		mode = *record.Mode
	}
	if mode == "send" && s.homeNotifyMode() == "off" {
		mode = "off"
	}
	if record.PublicURL != nil {
		publicURL = *record.PublicURL
	}
	return homeNotifySettings{Mode: mode, FlagMode: s.homeNotifyMode(), WebhookConfigured: len(record.Webhook) > 0, Signed: len(record.Secret) > 0, PublicURL: publicURL}
}

func validHomeWebhook(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > 2048 {
		return false
	}
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && (u.Host == "open.feishu.cn" || u.Host == "open.larksuite.com") && u.User == nil && u.RawQuery == "" && !u.ForceQuery && u.Fragment == "" && u.RawPath == "" && regexp.MustCompile(`^/open-apis/bot/v2/hook/[A-Za-z0-9_-]+$`).MatchString(u.Path)
}

func validHomePublicURL(value string) bool {
	if value == "" {
		return true
	}
	u, err := url.Parse(value)
	return len(value) <= 2048 && err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil && u.RawQuery == "" && !u.ForceQuery && u.Fragment == ""
}

func (s *Server) handleHomeNotifySettings(w http.ResponseWriter, r *http.Request) {
	s.homeNotifications.settingsMu.Lock()
	defer s.homeNotifications.settingsMu.Unlock()
	record, err := s.readHomeNotify(r.Context())
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if r.Method == http.MethodGet {
		writeJSON(w, 200, s.homeNotifyView(record))
		return
	}
	var req struct {
		Mode       *string `json:"mode"`
		WebhookURL *string `json:"webhookUrl"`
		Secret     *string `json:"secret"`
		PublicURL  *string `json:"publicUrl"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Mode != nil {
		switch *req.Mode {
		case "off", "dry_run", "send":
		default:
			writeErr(w, 400, "mode must be off, dry_run or send")
			return
		}
		if *req.Mode == "send" && s.homeNotifyMode() == "off" {
			writeErr(w, 403, "sending is disabled by --home-notify off")
			return
		}
		record.Mode = req.Mode
	}
	if req.WebhookURL != nil && !validHomeWebhook(*req.WebhookURL) {
		writeErr(w, 400, "webhookUrl must be a Feishu or Lark HTTPS bot webhook")
		return
	}
	if req.PublicURL != nil {
		if !validHomePublicURL(*req.PublicURL) {
			writeErr(w, 400, "publicUrl must be an HTTP(S) URL without credentials, query or fragment")
			return
		}
		record.PublicURL = req.PublicURL
	}
	if req.Secret != nil && len(*req.Secret) > 4096 {
		writeErr(w, 400, "secret is too long")
		return
	}
	if req.WebhookURL != nil || req.Secret != nil {
		box, err := s.secretBox()
		if err != nil {
			writeErr(w, 500, "notification secrets are unavailable")
			return
		}
		for _, field := range []struct {
			value   *string
			sealed  *[]byte
			context string
		}{{req.WebhookURL, &record.Webhook, homeWebhookContext}, {req.Secret, &record.Secret, homeSecretContext}} {
			if field.value == nil {
				continue
			}
			*field.sealed = nil
			if *field.value != "" {
				*field.sealed = box.Seal([]byte(*field.value), field.context)
			}
		}
	}
	raw, err := json.Marshal(record)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if err = s.DB.SetSetting(r.Context(), homeNotifySetting, string(raw)); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, s.homeNotifyView(record))
}

func (s *Server) sendHomeWebhook(ctx context.Context, record homeNotifyRecord, text string, at time.Time) error {
	if len(record.Webhook) == 0 {
		return errors.New("Feishu webhook is not configured")
	}
	box, err := s.secretBox()
	if err != nil {
		return errors.New("notification secrets are unavailable")
	}
	webhook, err := box.Unseal(record.Webhook, homeWebhookContext)
	if err != nil {
		return errors.New("notification secrets could not be opened")
	}
	var secret []byte
	if len(record.Secret) > 0 {
		secret, err = box.Unseal(record.Secret, homeSecretContext)
		if err != nil {
			return errors.New("notification secrets could not be opened")
		}
	}
	return chat.SendHomeWebhook(ctx, s.homeNotifications.webhookHTTP, string(webhook), string(secret), text, at)
}

func (s *Server) handleHomeNotifyTest(w http.ResponseWriter, r *http.Request) {
	record, err := s.readHomeNotify(r.Context())
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err = s.sendHomeWebhook(ctx, record, "[Pantheon] 测试通知", time.Now()); err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
