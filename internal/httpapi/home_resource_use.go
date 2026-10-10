package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
)

var errHomeResourceForbidden = errors.New("resource is not allowed for this project")

func (s *Server) homeSessionResources(project string, ids []string) ([]home.Resource, error) {
	if len(ids) > 200 {
		return nil, errors.New("too many resources")
	}
	out := []home.Resource{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		resource, err := s.Home.Resource(s.Cfg.CyxHome, id)
		if err != nil {
			return nil, err
		}
		if !resource.Allows(project) {
			return nil, errHomeResourceForbidden
		}
		out = append(out, resource)
	}
	return out, nil
}

func (s *Server) homeSessionEnv(ctx context.Context, resources []home.Resource, project, session string) ([]string, error) {
	env, ids := []string{}, []string{}
	for _, resource := range resources {
		values, err := s.useHomeResource(ctx, resource.ID, "session", project, session)
		if err != nil {
			return nil, err
		}
		names := []string{}
		for name := range values {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			env = append(env, name+"="+values[name])
		}
		ids = append(ids, resource.ID)
	}
	return append(env, "PANTHEON_RESOURCES="+strings.Join(ids, ",")), nil
}

func (s *Server) homeResourcePrompt(project string) string {
	resources, _, err := s.Home.Resources(s.Cfg.CyxHome)
	if err != nil {
		return "可用资源：资源索引不可用。"
	}
	allowed := []home.Resource{}
	for _, resource := range resources {
		if resource.Allows(project) {
			allowed = append(allowed, resource)
		}
	}
	servers := map[string]home.ServerStatus{}
	for _, resource := range allowed {
		if resource.Kind == "server" {
			for _, server := range s.homeServers(allowed).Servers {
				servers[server.ID] = server
			}
			break
		}
	}
	summaries := []map[string]any{}
	for _, resource := range allowed {
		summary := map[string]any{"id": resource.ID, "kind": resource.Kind, "title": resource.Title, "env": resource.Env, "sshAlias": resource.SSHAlias, "body": homePromptText(resource.Body, 1<<10)}
		if resource.Kind == "server" {
			summary["state"] = "unknown"
			if server, ok := servers[resource.GPUBoardID]; ok {
				summary["state"] = server.State
				if server.State == "fresh" {
					summary["gpus"] = server.GPUs
				}
			}
		}
		summaries = append(summaries, summary)
	}
	raw, _ := json.Marshal(summaries)
	return "可用资源（低占用仅是观察，不代表可分配；使用建议仍须用户确认）：\n" + string(raw)
}
