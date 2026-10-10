package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/parthenon"
	"github.com/jiangmuran/vibepanel/internal/session"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func (s *Server) registerHomeRoutes(r chi.Router) {
	s.registerHomeResourceRoutes(r)
	r.Get("/home", s.handleHome)
	r.Get("/home/models", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"harnesses": parthenon.Models()})
	})
	r.Get("/home/tasks", s.handleHomeTasks)
	r.Get("/home/fields", s.handleHomeFields)
	r.Put("/home/fields", s.handleHomeFields)
	r.Patch("/home/projects/{id}/meta", s.handleHomeMeta)
	r.Post("/home/projects/{id}/reports/{file}/reply", s.handleHomeReportReply)
	r.Get("/home/projects/{id}", s.handleHomeProject)
	r.Post("/home/projects/{id}/tasks", s.handleHomeCreateTask)
	r.Patch("/home/projects/{id}/tasks/{taskId}", s.handleHomePatchTask)
	r.Post("/home/projects/{id}/sessions", s.handleHomeSession)
	r.Get("/home/projects/{id}/threads", s.handleHomeThreads)
	r.Post("/home/projects/{id}/threads", s.handleHomeThreads)
	r.Patch("/home/projects/{id}/threads/{threadId}", s.handleHomeThread)
	r.Delete("/home/projects/{id}/threads/{threadId}", s.handleHomeThread)
	r.Post("/home/projects/{id}/discussion/{messageId}/retry", s.handleHomeRetry)
	r.Get("/home/projects/{id}/discussion", s.handleHomeDiscussion)
	r.Post("/home/projects/{id}/discussion", s.handleHomeDiscussion)
	r.Get("/home/notifications", s.handleHomeNotifications)
	r.Get("/home/notify-settings", s.handleHomeNotifySettings)
	r.Put("/home/notify-settings", s.handleHomeNotifySettings)
	r.Post("/home/notify-settings/test", s.handleHomeNotifyTest)
}

func homeSessionRoute(method, path string) bool {
	parts := strings.Split(strings.TrimPrefix(path, "/api/"), "/")
	return method == http.MethodPost && len(parts) == 4 && parts[0] == "home" && parts[1] == "projects" && parts[2] != "" && parts[3] == "sessions"
}

func homePlanningRoute(method, path string) bool {
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	if homeResourceRoute(method, path) {
		return true
	}
	if method == http.MethodGet && (path == "/api/home" || path == "/api/home/notifications" || path == "/api/home/models" || path == "/api/home/fields" || path == "/api/home/tasks" || path == "/api/home/notify-settings") {
		return true
	}
	if path == "/api/home/notify-settings/test" && method == http.MethodPost {
		return true
	}
	if (path == "/api/home/fields" || path == "/api/home/notify-settings") && method == http.MethodPut {
		return true
	}
	parts := strings.Split(strings.TrimPrefix(path, "/api/"), "/")
	if len(parts) < 3 || parts[0] != "home" || parts[1] != "projects" || parts[2] == "" {
		return false
	}
	if len(parts) == 3 {
		return method == http.MethodGet
	}
	if len(parts) == 4 {
		if parts[3] == "resources" {
			return method == http.MethodGet
		}
		if parts[3] == "meta" {
			return method == http.MethodPatch
		}
		if parts[3] == "discussion" || parts[3] == "threads" {
			return method == http.MethodGet || method == http.MethodPost
		}
		return parts[3] == "tasks" && method == http.MethodPost
	}
	if len(parts) == 5 && parts[3] == "threads" && parts[4] != "" {
		return method == http.MethodPatch || method == http.MethodDelete
	}
	if len(parts) == 6 && parts[3] == "discussion" && parts[4] != "" && parts[5] == "retry" {
		return method == http.MethodPost
	}
	if len(parts) == 6 && parts[3] == "reports" && parts[4] != "" && parts[5] == "reply" {
		return method == http.MethodPost
	}
	return len(parts) == 5 && parts[3] == "tasks" && parts[4] != "" && method == http.MethodPatch
}

func (s *Server) homeSnapshot(ctx context.Context, all bool) (home.Snapshot, error) {
	projects, err := s.DB.ListAllProjects(ctx)
	if err != nil {
		return home.Snapshot{}, err
	}
	sessions, err := s.DB.ListSessions(ctx)
	if err != nil {
		return home.Snapshot{}, err
	}
	runtime := []home.RuntimeProject{}
	for _, p := range projects {
		item := home.RuntimeProject{ID: p.ID, Path: p.Path, Sessions: []home.Session{}}
		for _, row := range sessions {
			if row.ProjectID != p.ID || row.Exited || row.ArchivedAt != nil {
				continue
			}
			agent := ""
			if session.IsAgentCommand(row.Command) {
				agent = row.Command
			} else if len(row.LaunchCommand) > 0 {
				if name := filepath.Base(row.LaunchCommand[0]); session.IsAgentCommand(name) {
					agent = name
				}
			}
			item.Sessions = append(item.Sessions, home.Session{ID: row.ID, Name: row.Title, State: string(row.State), Agent: agent, StateChangedAt: time.Unix(row.StateChangedAt, 0).Format(time.RFC3339)})
		}
		runtime = append(runtime, item)
	}
	return s.Home.Snapshot(s.Cfg.CyxHome, all, runtime), nil
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.homeSnapshot(r.Context(), r.URL.Query().Get("all") == "1")
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) homeProject(w http.ResponseWriter, r *http.Request) (home.Detail, bool) {
	snapshot, err := s.homeSnapshot(r.Context(), true)
	if err != nil {
		s.writeStoreErr(w, err)
		return home.Detail{}, false
	}
	if !snapshot.Available {
		writeErr(w, http.StatusServiceUnavailable, snapshot.Reason)
		return home.Detail{}, false
	}
	detail, ok := snapshot.Details[chi.URLParam(r, "id")]
	if !ok {
		writeErr(w, http.StatusNotFound, "project not found")
	}
	return detail, ok
}

func (s *Server) handleHomeProject(w http.ResponseWriter, r *http.Request) {
	if detail, ok := s.homeProject(w, r); ok {
		writeJSON(w, http.StatusOK, detail)
	}
}

func homeError(w http.ResponseWriter, err error) {
	var stale *home.StaleError
	switch {
	case errors.As(err, &stale):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "stale", "rev": stale.Rev})
	case errors.Is(err, home.ErrExists):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, home.ErrNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
	default:
		writeErr(w, http.StatusBadRequest, err.Error())
	}
}

func (s *Server) handleHomeCreateTask(w http.ResponseWriter, r *http.Request) {
	var req home.CreateTask
	if !decode(w, r, &req) {
		return
	}
	task, err := s.Home.Create(s.Cfg.CyxHome, chi.URLParam(r, "id"), req)
	if err != nil {
		homeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (s *Server) handleHomePatchTask(w http.ResponseWriter, r *http.Request) {
	var req home.PatchTask
	if !decode(w, r, &req) {
		return
	}
	task, err := s.Home.Patch(s.Cfg.CyxHome, chi.URLParam(r, "id"), chi.URLParam(r, "taskId"), req)
	if err != nil {
		homeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (s *Server) handleHomeSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProfileID string    `json:"profileId"`
		Name      string    `json:"name"`
		Resources *[]string `json:"resources"`
	}
	if !decode(w, r, &req) {
		return
	}
	detail, ok := s.homeProject(w, r)
	if !ok {
		return
	}
	if !detail.Project.PathExists {
		writeErr(w, http.StatusBadRequest, "the project checkout directory is missing")
		return
	}
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	ids := detail.Project.Meta.Resources
	if req.Resources != nil {
		ids = *req.Resources
	}
	resources, err := s.homeSessionResources(detail.Project.ID, ids)
	if errors.Is(err, errHomeResourceForbidden) {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}
	if err != nil {
		homeError(w, err)
		return
	}
	create := func(p store.Project, _ int) {
		s.createSession(w, r, createSessionRequest{ProjectID: p.ID, LaunchProfileID: req.ProfileID, Title: req.Name, resourceEnv: func(ctx context.Context, sid string) ([]string, error) {
			return s.homeSessionEnv(ctx, resources, detail.Project.ID, sid)
		}}, func(row store.Session) {
			writeJSON(w, http.StatusCreated, map[string]string{"sessionId": row.ID, "panelProjectId": p.ID})
		})
	}
	if detail.Project.PanelProjectID != nil {
		p, err := s.DB.GetProject(r.Context(), *detail.Project.PanelProjectID)
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		create(p, http.StatusOK)
		return
	}
	s.createProject(w, r, createProjectRequest{Path: detail.Project.Path, Name: detail.Project.ID}, create)
}

type homeSuggestion struct {
	Resources []string                   `json:"resources,omitempty"`
	Type      string                     `json:"type"`
	Task      *home.CreateTask           `json:"task,omitempty"`
	TaskID    string                     `json:"taskId,omitempty"`
	Status    string                     `json:"status,omitempty"`
	Name      string                     `json:"name,omitempty"`
	Fields    map[string]json.RawMessage `json:"fields,omitempty"`
	File      string                     `json:"file,omitempty"`
	Text      string                     `json:"text,omitempty"`
}

type homeSuggestedModel struct {
	Harness string `json:"harness"`
	Model   string `json:"model"`
	Reason  string `json:"reason"`
}

type homeReply struct {
	Reply          string              `json:"reply"`
	Suggestions    []homeSuggestion    `json:"suggestions,omitempty"`
	SuggestedModel *homeSuggestedModel `json:"suggestedModel,omitempty"`
}

func validHomeExecutor(harness, model string) bool {
	return (harness == "claude" || harness == "codex") && strings.TrimSpace(model) != "" && len(model) <= 200 && !strings.ContainsAny(model, "\r\n")
}

func parseHomeReply(text string) homeReply {
	var reply homeReply
	raw := strings.TrimSpace(text)
	err := json.Unmarshal([]byte(raw), &reply)
	if err != nil {
		// A reply may itself contain markdown fences; only unwrap the outer
		// block after trying bare JSON, and keep any fences inside its strings.
		start, end := strings.Index(raw, "```"), strings.LastIndex(raw, "```")
		if start >= 0 && end > start {
			if line := strings.IndexByte(raw[start:end], '\n'); line >= 0 {
				reply = homeReply{}
				err = json.Unmarshal([]byte(strings.TrimSpace(raw[start+line+1:end])), &reply)
			}
		}
	}
	if err != nil || strings.TrimSpace(reply.Reply) == "" {
		return homeReply{Reply: text}
	}
	valid := []homeSuggestion{}
	for _, suggestion := range reply.Suggestions {
		switch suggestion.Type {
		case "create_task":
			if suggestion.Task != nil && strings.TrimSpace(suggestion.Task.Title) != "" && (suggestion.Task.Status == "" || home.ValidStatus(suggestion.Task.Status)) {
				valid = append(valid, suggestion)
			}
		case "set_status":
			if suggestion.TaskID != "" && home.ValidStatus(suggestion.Status) {
				valid = append(valid, suggestion)
			}
		case "create_session":
			valid = append(valid, suggestion)
		case "use_resources":
			ok := len(suggestion.Resources) > 0 && len(suggestion.Resources) <= 200
			for _, id := range suggestion.Resources {
				ok = ok && home.ValidResourceID(id)
			}
			if ok {
				valid = append(valid, suggestion)
			}
		case "set_fields", "set_project":
			if (suggestion.Type == "set_project" || suggestion.TaskID != "") && validHomeSuggestionFields(suggestion) {
				valid = append(valid, suggestion)
			}
		case "reply_report":
			if suggestion.File != "" && filepath.Base(suggestion.File) == suggestion.File && !strings.ContainsAny(suggestion.File, "/\\") && strings.HasSuffix(suggestion.File, ".md") && strings.TrimSpace(suggestion.Text) != "" {
				valid = append(valid, suggestion)
			}
		}
	}
	reply.Suggestions = valid
	if reply.SuggestedModel != nil && !validHomeExecutor(reply.SuggestedModel.Harness, reply.SuggestedModel.Model) {
		reply.SuggestedModel = nil
	}
	return reply
}

func homePromptText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	for !utf8.RuneStart(text[limit]) {
		limit--
	}
	return text[:limit]
}
