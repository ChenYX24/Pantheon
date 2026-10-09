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
			board := strings.HasPrefix(path, "/api/projects/") && strings.HasSuffix(path, "/board") && strings.Count(path, "/") == 4
			workflow := strings.HasPrefix(path, "/api/projects/") && ((strings.HasSuffix(path, "/workflow") || strings.HasSuffix(path, "/notifications")) || strings.HasSuffix(path, "/discussion") || strings.HasSuffix(path, "/handoff") || strings.Contains(path, "/stages/") || strings.Contains(path, "/capabilities") || strings.HasSuffix(path, "/capability-inventory"))
			allowed := workflow || (r.Method == "GET" && ((path == "/api/workflow/executors" || path == "/api/workflow/settings") || path == "/api/workflow/recipients")) || (r.Method == "GET" && (path == "/api/state" || board)) ||
				(r.Method == "POST" && path == "/api/projects") || (r.Method == "PUT" && board)
			if !allowed {
				writeErr(w, http.StatusForbidden, "development planning preview: this operation is disabled")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
