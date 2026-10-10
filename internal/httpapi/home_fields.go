package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func (s *Server) handleHomeFields(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var req struct {
			Rev    string      `json:"rev"`
			Fields home.Fields `json:"fields"`
		}
		if !decode(w, r, &req) {
			return
		}
		rev, err := s.Home.PutFields(s.Cfg.CyxHome, req.Rev, req.Fields)
		if err != nil {
			homeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"fields": req.Fields, "rev": rev})
		return
	}
	fields, rev, err := s.Home.Fields(s.Cfg.CyxHome)
	if err != nil {
		homeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"fields": fields, "rev": rev})
}

func (s *Server) handleHomeMeta(w http.ResponseWriter, r *http.Request) {
	var req home.PatchMeta
	if !decode(w, r, &req) {
		return
	}
	meta, rev, err := s.Home.PatchMeta(s.Cfg.CyxHome, chi.URLParam(r, "id"), req)
	if err != nil {
		homeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meta": meta, "metaRev": rev})
}

func (s *Server) handleHomeTasks(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.homeSnapshot(r.Context(), r.URL.Query().Get("all") == "1")
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	type row struct {
		home.Task
		ProjectID string `json:"projectId"`
	}
	tasks := []row{}
	for _, project := range snapshot.Projects {
		for _, task := range snapshot.Details[project.ID].Tasks {
			if len(tasks) == 2000 {
				break
			}
			tasks = append(tasks, row{task, project.ID})
		}
	}
	fields, _, err := s.Home.Fields(s.Cfg.CyxHome)
	if err != nil {
		fields = home.DefaultFields()
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks, "fields": fields})
}

func (s *Server) handleHomeReportReply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Text string  `json:"text"`
		Rev  *string `json:"rev"`
	}
	if !decode(w, r, &req) {
		return
	}
	project := chi.URLParam(r, "id")
	report, err := s.Home.ReplyReport(s.Cfg.CyxHome, project, chi.URLParam(r, "file"), req.Text, req.Rev)
	if err != nil {
		homeError(w, err)
		return
	}
	if _, err = s.DB.AddHomeMessage(r.Context(), project, store.HomeMessage{Role: "user", Text: "回复汇报《" + report.Title + "》：" + req.Text}); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, report)
}
