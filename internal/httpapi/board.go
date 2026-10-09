package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func (s *Server) registerProjectBoardRoutes(r chi.Router) {
	r.Get("/projects/{id}/board", func(w http.ResponseWriter, r *http.Request) {
		board, err := s.DB.GetProjectBoard(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, board)
	})
	r.Put("/projects/{id}/board", func(w http.ResponseWriter, r *http.Request) {
		var board store.ProjectBoard
		if !decode(w, r, &board) {
			return
		}
		board.ProjectID = chi.URLParam(r, "id")
		if err := store.ValidateBoard(board); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		for _, task := range board.Tasks {
			if task.SessionID == "" {
				continue
			}
			session, err := s.DB.GetSession(r.Context(), task.SessionID)
			if err != nil || session.ProjectID != board.ProjectID {
				writeErr(w, 400, "invalid task session")
				return
			}
		}
		saved, err := s.DB.SaveProjectBoard(r.Context(), board)
		if errors.Is(err, store.ErrBoardStale) || errors.Is(err, store.ErrWorkflowBusy) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, saved)
	})
}
