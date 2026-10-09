package httpapi

import (
	"net/http"
	"strings"
)

// Development shares a Unix account with production. An isolated database and
// socket alone do not stop a settings endpoint from rewriting that account's
// agent hooks or restarting its production service.
func (s *Server) planningOnlyGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Cfg.PlanningOnly || s.Cfg.Development {
			path := r.URL.Path
			// The launch picker reads this redacted list on page load. Blocking
			// the read hides even installed profiles behind its Shell fallback;
			// it does not make the separately blocked launch operation safer.
			profiles := r.Method == http.MethodGet && path == "/api/launch-profiles"
			board := strings.HasPrefix(path, "/api/projects/") && strings.HasSuffix(path, "/board") && strings.Count(path, "/") == 4
			workflow := strings.HasPrefix(path, "/api/projects/") && ((strings.HasSuffix(path, "/workflow") || strings.HasSuffix(path, "/notifications")) || strings.HasSuffix(path, "/discussion") || strings.HasSuffix(path, "/handoff") || strings.Contains(path, "/stages/") || strings.Contains(path, "/capabilities") || strings.HasSuffix(path, "/capability-inventory"))
			allowed := profiles || workflow || (r.Method == "GET" && ((path == "/api/workflow/executors" || path == "/api/workflow/settings") || path == "/api/workflow/recipients")) || (r.Method == "GET" && (path == "/api/state" || board)) ||
				(r.Method == "POST" && path == "/api/projects") || (r.Method == "PUT" && board)
			if s.Cfg.DevelopmentTerminal && !s.Cfg.PlanningOnly && !s.Cfg.WorkflowExecute {
				allowed = allowed || developmentTerminalRoute(r.Method, path)
			}
			if !allowed {
				writeErr(w, http.StatusForbidden, "development planning preview: this operation is disabled")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Only the owner's manual workspace is enabled here. Host administration and
// transcript ingestion remain blocked even when a new API route is added.
func developmentTerminalRoute(method, path string) bool {
	if method == http.MethodGet {
		switch path {
		case "/api/system", "/api/usage", "/api/resources", "/api/resources/alert", "/api/token-usage", "/api/settings", "/api/browse", "/api/notes":
			return true
		}
	}
	if method == http.MethodPost {
		switch path {
		case "/api/sessions", "/api/sessions/restore", "/api/launch-profiles", "/api/launch-profiles/reorder", "/api/launch-profiles/restore", "/api/projects/reorder", "/api/clipboard", "/api/browse/mkdir", "/api/settings/tour":
			return true
		}
	}
	if method == http.MethodPut {
		switch path {
		case "/api/notes", "/api/settings/paste", "/api/settings/timezone", "/api/settings/archive":
			return true
		}
	}
	parts := strings.Split(strings.TrimPrefix(path, "/api/"), "/")
	if len(parts) < 2 || parts[1] == "" {
		return false
	}
	if len(parts) == 2 {
		switch parts[0] {
		case "sessions", "projects", "launch-profiles":
			return method == http.MethodPatch || method == http.MethodDelete
		}
	}
	if len(parts) == 3 {
		if parts[0] == "sessions" && parts[2] == "restart" {
			return method == http.MethodPost
		}
		if parts[0] == "projects" {
			switch parts[2] {
			case "files", "download", "preview":
				return method == http.MethodGet
			case "upload", "mkdir", "archive", "restore":
				return method == http.MethodPost
			case "notes":
				return method == http.MethodGet || method == http.MethodPut
			}
		}
	}
	return len(parts) == 4 && parts[0] == "projects" && parts[2] == "preview" && parts[3] == "render" && method == http.MethodGet
}
