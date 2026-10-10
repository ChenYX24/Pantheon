package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
)

func (s *Server) homeSSHAliases() []string {
	path := s.homeResources.sshConfig
	if path == "" {
		dir, err := os.UserHomeDir()
		if err != nil {
			return []string{}
		}
		path = filepath.Join(dir, ".ssh/config")
	}
	aliases, _ := home.SSHAliases(path)
	return aliases
}

func (s *Server) homeServers(resources []home.Resource) home.Servers {
	path := s.Cfg.GPUBoardSnapshot
	if strings.HasPrefix(path, "~/") {
		if dir, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(dir, path[2:])
		}
	}
	servers, board := home.ReadBoardSnapshot(path, s.Cfg.GPUBoardURL, time.Now())
	aliases := s.homeSSHAliases()
	for _, alias := range aliases {
		found := false
		for _, server := range servers {
			if server.Alias == alias || server.ID == alias {
				found = true
				break
			}
		}
		if !found {
			servers = append(servers, home.UnknownServer(alias, alias))
		}
	}
	for _, resource := range resources {
		if resource.Kind != "server" {
			continue
		}
		found := false
		for n := range servers {
			if servers[n].ID == resource.GPUBoardID {
				id := resource.ID
				servers[n].ResourceID = &id
				found = true
			}
		}
		if !found {
			server := home.UnknownServer(resource.GPUBoardID, resource.SSHAlias)
			id := resource.ID
			server.ResourceID, server.Label = &id, resource.Title
			servers = append(servers, server)
		}
	}
	return home.Servers{Servers: servers, SSHAliases: aliases, Board: board}
}

func (s *Server) handleHomeServers(w http.ResponseWriter, r *http.Request) {
	resources, _, err := s.Home.Resources(s.Cfg.CyxHome)
	if err != nil {
		resources = nil
	}
	writeJSON(w, 200, s.homeServers(resources))
}
