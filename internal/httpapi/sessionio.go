package httpapi

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// The owner's screen and input routes: what the CLI uses for `session
// screen` and `session send`, the same two things a plugin with
// read:terminal and sessions:input may do through its own door, here under
// the session. The terminal's own channel is the WebSocket; these exist for
// a shell inside a container, where there is no browser and the question is
// "what is this session showing, and type this into it".

func (s *Server) registerSessionIORoutes(r chi.Router) {
	r.Get("/sessions/{id}/screen", s.handleSessionScreen)
	r.Post("/sessions/{id}/input", s.handleSessionInput)
}

func (s *Server) handleSessionScreen(w http.ResponseWriter, r *http.Request) {
	sess, err := s.DB.GetSession(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	text, err := s.Tmux.Screen(r.Context(), sess.TmuxName, false)
	if err != nil {
		writeErr(w, http.StatusConflict, "the session's pane cannot be read right now")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"text": text})
}

// handleSessionInput pastes text into the session and, with submit, presses
// Enter. Audited: typing into an agent's session from a script is the kind
// of thing the activity log is for.
func (s *Server) handleSessionInput(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, _ := currentUserFrom(r)
	sess, err := s.DB.GetSession(ctx, chi.URLParam(r, "id"))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	var req struct {
		Text   string `json:"text"`
		Submit bool   `json:"submit"`
	}
	if !decode(w, r, &req) {
		return
	}
	if len(req.Text) > 64<<10 {
		writeErr(w, http.StatusRequestEntityTooLarge, "input is at most 64 KiB")
		return
	}
	if req.Text != "" {
		if err := s.Tmux.Paste(ctx, sess.TmuxName, req.Text); err != nil {
			writeErr(w, http.StatusConflict, "the pane did not take the input: "+err.Error())
			return
		}
	}
	if req.Submit {
		if err := s.Tmux.Keys(ctx, sess.TmuxName, "Enter"); err != nil {
			writeErr(w, http.StatusConflict, "the pane did not take Enter: "+err.Error())
			return
		}
	}
	s.audit(ctx, "session.input", u.Username, s.clientIP(r), fmt.Sprintf("%d bytes into %s", len(req.Text), sess.ID))
	w.WriteHeader(http.StatusNoContent)
}
