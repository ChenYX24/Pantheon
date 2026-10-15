package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/jiangmuran/vibepanel/internal/chat"
	"github.com/jiangmuran/vibepanel/internal/store"
	"github.com/jiangmuran/vibepanel/internal/ws"
)

// A session speaking (docs/cli.md): `say` is a line in its messages, which
// the chat card shows as the last thing it said and the routes push by
// their rules; `notify` is an explicit call for attention -- a toast and a
// browser notification on every open page, and a card on the phone whatever
// the session's state, with the choices as buttons. Both through the
// session's own door and the owner's session routes, one implementation.
//
// Rate-limited per session, because an agent in a loop is the most likely
// caller: a notice a second would be a phone that never stops.

const (
	noticeRateSay    = 60 // a minute, per session
	noticeRateNotify = 6
)

type noticeState struct {
	mu    sync.Mutex
	when  map[string][]time.Time
	bytes map[string][]byteStamp
}

// sessionNoticeEvent is what the page receives (ws "notice").
type sessionNoticeEvent struct {
	T         string   `json:"t"`
	SessionID string   `json:"sessionId"`
	Title     string   `json:"title"`
	Project   string   `json:"project"`
	Level     string   `json:"level"`
	Text      string   `json:"text"`
	Choices   []string `json:"choices"`
	URL       string   `json:"url"`
}

func (s *Server) registerSessionNoticeRoutes(r chi.Router) {
	r.Post("/sessions/{id}/say", s.handleSessionSay)
	r.Post("/sessions/{id}/notify", s.handleSessionNotify)
}

// noticeAdmit is the per-session rate: a 429 with how long to wait.
func (s *Server) noticeAdmit(sessionID, kind string, limit int) (int, bool) {
	st := &s.ntc
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.when == nil {
		st.when = map[string][]time.Time{}
	}
	key := sessionID + "/" + kind
	now := time.Now()
	recent := st.when[key][:0]
	for _, t := range st.when[key] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if len(recent) >= limit {
		st.when[key] = recent
		return int((time.Minute - now.Sub(recent[0])).Seconds()) + 1, false
	}
	st.when[key] = append(recent, now)
	return 0, true
}

func (s *Server) sessionSay(ctx context.Context, row store.Session, text, by, ip string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("nothing to say")
	}
	if r := []rune(text); len(r) > chat.NoticeMaxText {
		text = string(r[:chat.NoticeMaxText])
	}
	m, err := s.DB.AddSessionMessage(ctx, store.SessionMessage{SessionID: row.ID, Kind: store.MessageNotice, Text: text})
	if err != nil {
		return err
	}
	if s.Chat != nil {
		s.Chat.SessionSaid(row, m)
	}
	s.broadcastNotice(ctx, row, "say", text, nil)
	s.audit(ctx, "session.said", by, ip, fmt.Sprintf("%s: %d bytes", row.ID, len(text)))
	return nil
}

func (s *Server) sessionNotify(ctx context.Context, row store.Session, n chat.Notice, by, ip string) (int, error) {
	n = chat.CleanNotice(n)
	if n.Text == "" {
		return 0, errors.New("nothing to say")
	}
	if _, err := s.DB.AddSessionMessage(ctx, store.SessionMessage{SessionID: row.ID, Kind: store.MessageNotice, Text: n.Text}); err != nil {
		return 0, err
	}
	sent := 0
	if s.Chat != nil {
		sent = s.Chat.Notify(ctx, row, n)
	}
	s.broadcastNotice(ctx, row, n.Level, n.Text, n.Choices)
	s.audit(ctx, "session.notified", by, ip, fmt.Sprintf("%s: %d bytes, %d choice(s), %d contact(s)", row.ID, len(n.Text), len(n.Choices), sent))
	return sent, nil
}

func (s *Server) broadcastNotice(ctx context.Context, row store.Session, level, text string, choices []string) {
	s.broadcastNoticeWith(ctx, row, level, text, choices, "")
}

func (s *Server) broadcastNoticeURL(ctx context.Context, row store.Session, level, text, url string) {
	s.broadcastNoticeWith(ctx, row, level, text, nil, url)
}

func (s *Server) broadcastNoticeWith(ctx context.Context, row store.Session, level, text string, choices []string, url string) {
	if s.Hub == nil {
		return
	}
	project := ""
	if p, err := s.DB.GetProject(ctx, row.ProjectID); err == nil {
		project = p.Name
	}
	if choices == nil {
		choices = []string{}
	}
	payload, err := json.Marshal(sessionNoticeEvent{T: ws.MsgNotice, SessionID: row.ID, Title: row.Title, Project: project, Level: level, Text: text, Choices: choices, URL: url})
	if err != nil {
		return
	}
	s.Hub.BroadcastEvent(payload)
}

type sayRequest struct {
	Text string `json:"text"`
}

type notifyRequest struct {
	Text    string   `json:"text"`
	Level   string   `json:"level"`
	Choices []string `json:"choices"`
}

// The two handlers below serve both doors: the owner's, where the session
// is the URL's, and the session's own, where it is the token's.

func (s *Server) handleSessionSay(w http.ResponseWriter, r *http.Request) {
	row, by, ok := s.noticeSubject(w, r)
	if !ok {
		return
	}
	var req sayRequest
	if !decode(w, r, &req) {
		return
	}
	if retry, ok := s.noticeAdmit(row.ID, "say", noticeRateSay); !ok {
		w.Header().Set("Retry-After", fmt.Sprint(retry))
		writeErr(w, http.StatusTooManyRequests, "this session has said enough for a minute")
		return
	}
	if err := s.sessionSay(r.Context(), row, req.Text, by, s.clientIP(r)); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSessionNotify(w http.ResponseWriter, r *http.Request) {
	row, by, ok := s.noticeSubject(w, r)
	if !ok {
		return
	}
	var req notifyRequest
	if !decode(w, r, &req) {
		return
	}
	if retry, ok := s.noticeAdmit(row.ID, "notify", noticeRateNotify); !ok {
		w.Header().Set("Retry-After", fmt.Sprint(retry))
		writeErr(w, http.StatusTooManyRequests, "this session has notified enough for a minute; say it in the summary")
		return
	}
	sent, err := s.sessionNotify(r.Context(), row, chat.Notice{Level: req.Level, Text: req.Text, Choices: req.Choices}, by, s.clientIP(r))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contacts": sent})
}

// noticeSubject is the session a say or notify is about: the token's on
// the session's door, the URL's on the owner's.
func (s *Server) noticeSubject(w http.ResponseWriter, r *http.Request) (store.Session, string, bool) {
	if row := meFrom(r); row.ID != "" {
		return row, "session:" + row.ID, true
	}
	row, err := s.DB.GetSession(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return store.Session{}, "", false
	}
	u, _ := currentUserFrom(r)
	return row, u.Username, true
}
