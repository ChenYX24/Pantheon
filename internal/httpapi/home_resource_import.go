package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
)

const homeResourceBody = "## 用途\n\n\n## 使用方法\n\n\n## 限制\n\n低占用仅是观察，不代表可分配。\n"

func homeResourceFields(fields map[string]any) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for key, value := range fields {
		out[key], _ = json.Marshal(value)
	}
	return out
}

func containsHomeAlias(aliases []string, alias string) bool {
	for _, candidate := range aliases {
		if candidate == alias {
			return true
		}
	}
	return false
}

func (s *Server) handleHomeImportSSH(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Aliases []string `json:"aliases"`
	}
	if !decode(w, r, &req) {
		return
	}
	if len(req.Aliases) > 200 {
		writeErr(w, 400, "too many aliases")
		return
	}
	aliases := s.homeSSHAliases()
	for _, alias := range req.Aliases {
		if !containsHomeAlias(aliases, alias) {
			writeErr(w, 400, "alias must be a concrete Host in the SSH config")
			return
		}
	}
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	resources, _, err := s.Home.Resources(s.Cfg.CyxHome)
	if err != nil {
		homeError(w, err)
		return
	}
	used, ids := map[string]bool{}, map[string]bool{}
	for _, resource := range resources {
		used[resource.SSHAlias], ids[resource.ID] = true, true
	}
	servers := s.homeServers(resources).Servers
	created, skipped := []string{}, []string{}
	for _, alias := range req.Aliases {
		if used[alias] {
			skipped = append(skipped, alias)
			continue
		}
		id := home.ResourceSlug(alias)
		if ids[id] {
			id = home.ResourceSlug("server-" + alias)
		}
		if ids[id] {
			skipped = append(skipped, alias)
			continue
		}
		title, boardID := alias, alias
		for _, server := range servers {
			if server.Alias == alias || server.ID == alias {
				boardID = server.ID
				if server.Label != "" {
					title = server.Label
				}
				break
			}
		}
		resource, err := s.Home.CreateResource(s.Cfg.CyxHome, homeResourceFields(map[string]any{"id": id, "kind": "server", "title": title, "ssh_alias": alias, "gpu_board_id": boardID, "check": "ssh", "body": homeResourceBody}))
		if errors.Is(err, home.ErrExists) {
			skipped = append(skipped, alias)
			continue
		}
		if err != nil {
			homeError(w, err)
			return
		}
		created = append(created, resource.ID)
		used[alias], ids[resource.ID] = true, true
	}
	writeJSON(w, 200, map[string]any{"created": created, "skipped": skipped})
}

func (s *Server) handleHomeImportProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProfileID  string `json:"profileId"`
		ResourceID string `json:"resourceId"`
	}
	if !decode(w, r, &req) {
		return
	}
	profile, err := s.DB.GetLaunchProfile(r.Context(), req.ProfileID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if req.ResourceID == "" {
		req.ResourceID = home.ResourceSlug(profile.Name)
	}
	if !home.ValidResourceID(req.ResourceID) {
		writeErr(w, 400, "invalid resource id")
		return
	}
	values, names := map[string]string{}, []string{}
	provider, baseURL := "other", ""
	for _, variable := range profile.Env {
		if variable.Value == "" {
			continue
		}
		if strings.HasSuffix(variable.Name, "_BASE_URL") {
			baseURL = variable.Value
			continue
		}
		if !strings.HasSuffix(variable.Name, "_KEY") && !strings.HasSuffix(variable.Name, "_TOKEN") && !strings.HasSuffix(variable.Name, "_SECRET") {
			continue
		}
		if !home.ValidSecretName(variable.Name) || len(variable.Value) > 8<<10 || strings.ContainsRune(variable.Value, 0) {
			writeErr(w, 400, "profile contains an invalid resource secret")
			return
		}
		values[variable.Name] = variable.Value
		if strings.HasPrefix(variable.Name, "ANTHROPIC_") {
			provider = "anthropic"
		}
		if strings.HasPrefix(variable.Name, "OPENAI_") && provider == "other" {
			provider = "openai"
		}
	}
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	if baseURL == "" && provider == "openai" {
		baseURL = "https://api.openai.com/v1"
	}
	// A profile may have been filled incorrectly; never copy a known secret
	// into the file-backed URL just because its variable has a URL-like name.
	for _, value := range values {
		if strings.Contains(baseURL, value) {
			writeErr(w, 400, "profile base URL contains a secret")
			return
		}
	}
	if baseURL != "" {
		if _, err := homeCheckRequest(r.Context(), baseURL); err != nil {
			writeErr(w, 400, "profile base URL is invalid")
			return
		}
	}
	s.homeResources.mu.Lock()
	defer s.homeResources.mu.Unlock()
	box, err := s.secretBox()
	if err != nil {
		writeErr(w, 500, "resource secrets are unavailable")
		return
	}
	sealed := map[string][]byte{}
	for name, value := range values {
		sealed[name] = box.Seal([]byte(value), resourceSecretContext(req.ResourceID, name))
	}
	fields := homeResourceFields(map[string]any{"kind": "api", "provider": provider, "base_url": baseURL, "env": names, "check": "provider"})
	resource, err := s.Home.Resource(s.Cfg.CyxHome, req.ResourceID)
	status := http.StatusOK
	if errors.Is(err, home.ErrNotFound) {
		fields["id"], _ = json.Marshal(req.ResourceID)
		fields["title"], _ = json.Marshal(profile.Name)
		fields["body"], _ = json.Marshal(homeResourceBody)
		resource, err = s.Home.CreateResource(s.Cfg.CyxHome, fields)
		status = http.StatusCreated
	} else if err == nil {
		resource, err = s.Home.PatchResource(s.Cfg.CyxHome, resource.ID, resource.Rev, fields)
	}
	if err != nil {
		homeError(w, err)
		return
	}
	if err = s.DB.PutResourceSecrets(r.Context(), resource.ID, sealed, time.Now().UTC()); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeHomeResource(w, r, resource, status, false)
}
