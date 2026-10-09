package httpapi

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/jiangmuran/vibepanel/internal/chat"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/store"
)

type homeNotifications struct {
	mu          sync.Mutex
	initialized bool
	outbound    *chat.Bridge
	// Tests substitute an adapter without starting any channel or network loop.
	send func(context.Context, store.HomeDelivery) error
}

func (s *Server) homeNotifyMode() string {
	if s.Cfg.HomeNotify == "" {
		return "off"
	}
	return s.Cfg.HomeNotify
}

func (s *Server) handleHomeNotifications(w http.ResponseWriter, r *http.Request) {
	items, err := s.DB.HomeDeliveries(r.Context())
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mode": s.homeNotifyMode(), "items": items})
}

func (s *Server) RunHomeNotifications(ctx context.Context) {
	if s.homeNotifyMode() == "off" {
		return
	}
	first := time.NewTimer(10 * time.Second)
	defer first.Stop()
	select {
	case <-ctx.Done():
		return
	case <-first.C:
	}
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		if err := s.homeNotificationTick(ctx, time.Now()); err != nil && s.Log != nil {
			s.Log.Warn("home notifications", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func homeNotificationText(todo home.Todo, publicURL, basePath, lang string) string {
	link := strings.TrimRight(publicURL, "/") + basePath
	if todo.Kind == "session_waiting" && todo.Link.SessionID != "" {
		link += "/?session=" + url.QueryEscape(todo.Link.SessionID)
	} else {
		link += "/home?project=" + url.QueryEscape(todo.ProjectID) + "&task=" + url.QueryEscape(todo.Link.TaskID)
	}
	return "[Pantheon] " + todo.ProjectID + " · " + chat.HomeKindLabel(lang, todo.Kind) + " · " + todo.Title + "\n" + todo.Detail + "\n" + link
}

func (s *Server) homeNotificationTick(ctx context.Context, at time.Time) error {
	state := &s.homeNotifications
	state.mu.Lock()
	defer state.mu.Unlock()
	mode := s.homeNotifyMode()
	if mode == "off" {
		return nil
	}
	snapshot, err := s.homeSnapshot(ctx, false)
	if err != nil {
		return err
	}
	if !snapshot.Available {
		return nil
	}
	baseline := false
	if !state.initialized {
		baseline, err = s.DB.HomeDeliveriesEmpty(ctx)
		if err != nil {
			return err
		}
	}
	peers, err := s.DB.PairedChatPeers(ctx)
	if err != nil {
		return err
	}
	recipients := []string{}
	for _, peer := range peers {
		if peer.Channel == "feishu" {
			recipients = append(recipients, peer.PeerID)
		}
	}
	if len(recipients) == 0 {
		recipients = append(recipients, "")
	}
	lang, err := s.DB.GetSetting(ctx, chat.LangKey, "zh")
	if err != nil {
		return err
	}
	deliveries := []store.HomeDelivery{}
	for _, todo := range snapshot.Todos {
		for _, peer := range recipients {
			status := "dry_run"
			if mode == "send" && peer != "" {
				status = "pending"
			}
			if baseline {
				status = "baseline"
			}
			deliveries = append(deliveries, store.HomeDelivery{TodoID: todo.ID, ProjectID: todo.ProjectID, Channel: "feishu", Peer: peer, Status: status, Text: homeNotificationText(todo, s.Cfg.HomePublicURL, s.Cfg.BasePath, lang), CreatedAt: at.Format(time.RFC3339)})
		}
	}
	if err = s.DB.RecordHomeDeliveries(ctx, deliveries); err != nil {
		return err
	}
	state.initialized = true
	if mode != "send" {
		return nil
	}
	pending, err := s.DB.PendingHomeDeliveries(ctx, at.Unix())
	if err != nil {
		return err
	}
	for _, n := range pending {
		if err := ctx.Err(); err != nil {
			return err
		}
		created, _ := time.Parse(time.RFC3339, n.CreatedAt)
		if !at.Before(created.Add(24*time.Hour)) || n.Attempts >= 3 {
			n.Status = "failed"
			if err = s.DB.UpdateHomeDelivery(ctx, n); err != nil {
				return err
			}
			continue
		}
		n.Attempts++
		n.NextAttemptAt = at.Add(time.Duration(n.Attempts) * time.Minute).Unix()
		// Persist the attempt before contacting Feishu so restarts cannot reset
		// the retry budget. A network delivery is still at-least-once.
		if err = s.DB.UpdateHomeDelivery(ctx, n); err != nil {
			return err
		}
		sendctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		switch {
		case state.send != nil:
			err = state.send(sendctx, n)
		case s.Chat != nil:
			err = s.Chat.SendHomeNotification(sendctx, n.Peer, n.Text)
		default:
			if state.outbound == nil {
				box, boxErr := s.secretBox()
				err = boxErr
				if boxErr == nil {
					state.outbound = chat.New(chat.Deps{DB: s.DB, Box: box, Log: s.Log, PublicURL: s.Cfg.PublicURL})
				}
			}
			if state.outbound != nil {
				err = state.outbound.SendHomeNotification(sendctx, n.Peer, n.Text)
			}
		}
		cancel()
		if err == nil {
			n.Status = "sent"
			sent := at.Format(time.RFC3339)
			n.SentAt = &sent
		} else if n.Attempts >= 3 {
			n.Status = "failed"
		}
		if err = s.DB.UpdateHomeDelivery(ctx, n); err != nil {
			return err
		}
	}
	return nil
}
