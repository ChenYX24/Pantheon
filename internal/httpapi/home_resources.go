package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/store"
)

type homeResources struct {
	mu        sync.Mutex
	checkHTTP *http.Client
	sshConfig string
}

type homeResourceLastCheck struct {
	At      string `json:"at"`
	OK      bool   `json:"ok"`
	Summary string `json:"summary"`
}

type homeResource struct {
	home.Resource
	Secrets   []store.ResourceSecret `json:"secrets"`
	LastCheck *homeResourceLastCheck `json:"lastCheck"`
	Server    *home.ServerStatus     `json:"server"`
}

type homeResourceOrphan struct {
	ResourceID string   `json:"resourceId"`
	Names      []string `json:"names"`
}

type homeResourceList struct {
	Resources []homeResource       `json:"resources"`
	Orphans   []homeResourceOrphan `json:"orphans"`
	Warnings  []home.Warning       `json:"warnings"`
}

func (s *Server) registerHomeResourceRoutes(r chi.Router) {
	r.Get("/home/resources", s.handleHomeResources)
	r.Post("/home/resources", s.handleHomeCreateResource)
	r.Get("/home/resources/{id}", s.handleHomeResource)
	r.Patch("/home/resources/{id}", s.handleHomePatchResource)
	r.Delete("/home/resources/{id}", s.handleHomeDeleteResource)
	r.Put("/home/resources/{id}/secrets/{name}", s.handleHomeResourceSecret)
	r.Delete("/home/resources/{id}/secrets/{name}", s.handleHomeResourceSecret)
	r.Post("/home/resources/{id}/check", s.handleHomeResourceCheck)
	r.Post("/home/resources/import/ssh", s.handleHomeImportSSH)
	r.Post("/home/resources/import/profile", s.handleHomeImportProfile)
	r.Get("/home/servers", s.handleHomeServers)
	r.Get("/home/projects/{id}/resources", s.handleHomeProjectResources)
}

func homeResourceRoute(method, path string) bool {
	if path == "/api/home/servers" {
		return method == http.MethodGet
	}
	if path == "/api/home/resources" {
		return method == http.MethodGet || method == http.MethodPost
	}
	p := strings.Split(path, "/")
	if len(p) < 5 || p[0] != "" || p[1] != "api" || p[2] != "home" || p[3] != "resources" || p[4] == "" {
		return false
	}
	if len(p) == 5 {
		return method == http.MethodGet || method == http.MethodPatch || method == http.MethodDelete
	}
	if len(p) == 6 {
		if p[4] == "import" && (p[5] == "ssh" || p[5] == "profile") {
			return method == http.MethodPost
		}
		return p[5] == "check" && method == http.MethodPost
	}
	return len(p) == 7 && p[5] == "secrets" && p[6] != "" && (method == http.MethodPut || method == http.MethodDelete)
}

func (s *Server) homeResourceViews(ctx context.Context, resources []home.Resource) ([]homeResource, error) {
	secrets, err := s.DB.ResourceSecrets(ctx)
	if err != nil {
		return nil, err
	}
	servers := map[string]home.ServerStatus{}
	for _, resource := range resources {
		if resource.Kind == "server" {
			for _, server := range s.homeServers(resources).Servers {
				servers[server.ID] = server
			}
			break
		}
	}
	out := []homeResource{}
	for _, resource := range resources {
		view := homeResource{Resource: resource, Secrets: []store.ResourceSecret{}}
		byName := map[string]store.ResourceSecret{}
		for _, name := range resource.Env {
			byName[name] = store.ResourceSecret{Name: name}
		}
		for _, secret := range secrets {
			if secret.ResourceID == resource.ID {
				byName[secret.Name] = secret
			}
		}
		for _, secret := range byName {
			view.Secrets = append(view.Secrets, secret)
		}
		sort.Slice(view.Secrets, func(i, j int) bool { return view.Secrets[i].Name < view.Secrets[j].Name })
		checks, err := s.DB.ResourceChecks(ctx, resource.ID)
		if err != nil {
			return nil, err
		}
		if len(checks) > 0 {
			view.LastCheck = &homeResourceLastCheck{checks[0].At, checks[0].OK, checks[0].Summary}
		}
		if resource.Kind == "server" {
			if server, ok := servers[resource.GPUBoardID]; ok {
				view.Server = &server
			}
		}
		out = append(out, view)
	}
	return out, nil
}

func (s *Server) homeResourceList(ctx context.Context) (homeResourceList, error) {
	out := homeResourceList{Resources: []homeResource{}, Orphans: []homeResourceOrphan{}, Warnings: []home.Warning{}}
	resources, warnings, err := s.Home.Resources(s.Cfg.CyxHome)
	if err != nil {
		return out, err
	}
	out.Warnings = warnings
	out.Resources, err = s.homeResourceViews(ctx, resources)
	if err != nil {
		return out, err
	}
	present := map[string]bool{}
	for _, resource := range resources {
		present[resource.ID] = true
	}
	// A malformed file is still present; its secrets are not orphans.
	for _, warning := range warnings {
		id := strings.TrimSuffix(strings.TrimPrefix(warning.File, "pantheon/resources/"), ".md")
		present[id] = true
	}
	secrets, err := s.DB.ResourceSecrets(ctx)
	if err != nil {
		return out, err
	}
	for _, secret := range secrets {
		if present[secret.ResourceID] {
			continue
		}
		if len(out.Orphans) == 0 || out.Orphans[len(out.Orphans)-1].ResourceID != secret.ResourceID {
			out.Orphans = append(out.Orphans, homeResourceOrphan{ResourceID: secret.ResourceID, Names: []string{}})
		}
		last := &out.Orphans[len(out.Orphans)-1]
		last.Names = append(last.Names, secret.Name)
	}
	return out, nil
}

func (s *Server) handleHomeResources(w http.ResponseWriter, r *http.Request) {
	list, err := s.homeResourceList(r.Context())
	if err != nil {
		homeError(w, err)
		return
	}
	writeJSON(w, 200, list)
}

func (s *Server) writeHomeResource(w http.ResponseWriter, r *http.Request, resource home.Resource, status int, detail bool) {
	views, err := s.homeResourceViews(r.Context(), []home.Resource{resource})
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if !detail {
		writeJSON(w, status, views[0])
		return
	}
	checks, err := s.DB.ResourceChecks(r.Context(), resource.ID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	uses, err := s.DB.ResourceUses(r.Context(), resource.ID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, status, struct {
		homeResource
		Checks []store.ResourceCheck `json:"checks"`
		Uses   []store.ResourceUse   `json:"uses"`
	}{views[0], checks, uses})
}

func (s *Server) handleHomeResource(w http.ResponseWriter, r *http.Request) {
	resource, err := s.Home.Resource(s.Cfg.CyxHome, chi.URLParam(r, "id"))
	if err != nil {
		homeError(w, err)
		return
	}
	s.writeHomeResource(w, r, resource, 200, true)
}

func (s *Server) handleHomeCreateResource(w http.ResponseWriter, r *http.Request) {
	var fields map[string]json.RawMessage
	if !decode(w, r, &fields) {
		return
	}
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	resource, err := s.Home.CreateResource(s.Cfg.CyxHome, fields)
	if err != nil {
		homeError(w, err)
		return
	}
	s.writeHomeResource(w, r, resource, 201, false)
}

func (s *Server) handleHomePatchResource(w http.ResponseWriter, r *http.Request) {
	var fields map[string]json.RawMessage
	if !decode(w, r, &fields) {
		return
	}
	var rev string
	if json.Unmarshal(fields["rev"], &rev) != nil {
		writeErr(w, 400, "rev is required")
		return
	}
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	resource, err := s.Home.PatchResource(s.Cfg.CyxHome, chi.URLParam(r, "id"), rev, fields)
	if err != nil {
		homeError(w, err)
		return
	}
	s.writeHomeResource(w, r, resource, 200, false)
}

func (s *Server) handleHomeDeleteResource(w http.ResponseWriter, r *http.Request) {
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	id := chi.URLParam(r, "id")
	if err := s.Home.DeleteResource(s.Cfg.CyxHome, id, r.URL.Query().Get("rev")); err != nil {
		homeError(w, err)
		return
	}
	if err := s.DB.DeleteResourceData(r.Context(), id); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	w.WriteHeader(204)
}

func resourceSecretContext(id, name string) string { return "resource:" + id + ":" + name }

func (s *Server) handleHomeResourceSecret(w http.ResponseWriter, r *http.Request) {
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	id, name := chi.URLParam(r, "id"), chi.URLParam(r, "name")
	if !home.ValidResourceID(id) || !home.ValidSecretName(name) {
		writeErr(w, 400, "invalid resource id or secret name")
		return
	}
	if r.Method == http.MethodDelete {
		// This route also removes secrets whose file disappeared outside the API.
		if err := s.DB.DeleteResourceSecret(r.Context(), id, name); err != nil {
			s.writeStoreErr(w, err)
			return
		}
		w.WriteHeader(204)
		return
	}
	if _, err := s.Home.Resource(s.Cfg.CyxHome, id); err != nil {
		homeError(w, err)
		return
	}
	var req struct {
		Value string `json:"value"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Value == "" || len(req.Value) > 8<<10 || strings.ContainsRune(req.Value, 0) {
		writeErr(w, 400, "value must contain 1–8192 bytes without NUL")
		return
	}
	box, err := s.secretBox()
	if err != nil {
		writeErr(w, 500, "resource secrets are unavailable")
		return
	}
	at := time.Now().UTC()
	sealed := box.Seal([]byte(req.Value), resourceSecretContext(id, name))
	if err = s.DB.PutResourceSecrets(r.Context(), id, map[string][]byte{name: sealed}, at); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, store.ResourceSecret{Name: name, Configured: true, UpdatedAt: at.Format(time.RFC3339Nano)})
}

func (s *Server) useHomeResource(ctx context.Context, id, purpose, project, session string) (map[string]string, error) {
	sealed, err := s.DB.UseResourceSecrets(ctx, id, purpose, project, session, time.Now().UTC())
	if err != nil {
		return nil, errors.New("resource receipt could not be recorded")
	}
	values := map[string]string{}
	if len(sealed) == 0 {
		return values, nil
	}
	box, err := s.secretBox()
	if err != nil {
		return nil, errors.New("resource secrets are unavailable")
	}
	for name, encrypted := range sealed {
		value, err := box.Unseal(encrypted, resourceSecretContext(id, name))
		if err != nil {
			return nil, errors.New("resource secrets could not be opened")
		}
		values[name] = string(value)
	}
	return values, nil
}

func (s *Server) handleHomeProjectResources(w http.ResponseWriter, r *http.Request) {
	detail, ok := s.homeProject(w, r)
	if !ok {
		return
	}
	resources, warnings, err := s.Home.Resources(s.Cfg.CyxHome)
	if err != nil {
		homeError(w, err)
		return
	}
	allowed := []home.Resource{}
	for _, resource := range resources {
		if resource.Allows(detail.Project.ID) {
			allowed = append(allowed, resource)
		}
	}
	views, err := s.homeResourceViews(r.Context(), allowed)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"resources": views, "defaultResources": detail.Project.Meta.Resources, "warnings": warnings})
}
