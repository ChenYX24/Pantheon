package parthenon

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type CapabilitySource struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Scope   string `json:"scope"`
	Path    string `json:"path"`
	Digest  string `json:"digest"`
	Content string `json:"content,omitempty"`
}

// MCP inventory exposes server names only. Credentials and transport headers
// never enter the JSON returned to the browser or a project-manager prompt.
func Inventory(project string) []CapabilitySource {
	home, _ := os.UserHomeDir()
	out := []CapabilitySource{}
	roots := []struct{ path, scope string }{{filepath.Join(home, ".codex", "skills"), "global/codex"}, {filepath.Join(home, ".claude", "skills"), "global/claude"}, {filepath.Join(project, ".agents", "skills"), "project"}, {filepath.Join(project, ".claude", "skills"), "project"}, {filepath.Join(project, "skills"), "project"}, {filepath.Join(home, ".codex", "plugins", "cache"), "plugin/codex"}, {filepath.Join(home, ".claude", "plugins", "cache"), "plugin/claude"}}
	for _, root := range roots {
		if resolved, err := filepath.EvalSymlinks(root.path); err == nil {
			root.path = resolved
		}
		_ = filepath.WalkDir(root.path, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			rel, _ := filepath.Rel(root.path, path)
			if strings.Count(rel, string(filepath.Separator)) > 4 && d.IsDir() {
				return filepath.SkipDir
			}
			candidate := path
			if d.Type()&os.ModeSymlink != 0 && d.Name() != "SKILL.md" {
				candidate = filepath.Join(path, "SKILL.md")
			}
			if d.IsDir() || (d.Name() != "SKILL.md" && candidate == path) || len(out) >= 200 {
				return nil
			}
			info, err := os.Stat(candidate)
			if err != nil || info.Size() > 64000 {
				return nil
			}
			raw, err := os.ReadFile(candidate)
			if err != nil {
				return nil
			}
			sum := sha256.Sum256(raw)
			out = append(out, CapabilitySource{Name: filepath.Base(filepath.Dir(candidate)), Kind: "skill", Scope: root.scope, Path: candidate, Digest: hex.EncodeToString(sum[:]), Content: string(raw)})
			return nil
		})
	}
	for _, path := range []string{filepath.Join(project, ".mcp.json"), filepath.Join(home, ".claude.json")} {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var data struct {
			Servers map[string]json.RawMessage `json:"mcpServers"`
		}
		if json.Unmarshal(raw, &data) != nil {
			continue
		}
		for name := range data.Servers {
			out = append(out, CapabilitySource{Name: name, Kind: "mcp", Scope: "configured", Path: path})
		}
	}
	path := filepath.Join(home, ".codex", "config.toml")
	raw, err := os.ReadFile(path)
	if err == nil {
		for _, name := range configuredMCPNames(raw) {
			out = append(out, CapabilitySource{Name: name, Kind: "mcp", Scope: "global/codex", Path: path})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Scope+out[i].Name < out[j].Scope+out[j].Name })
	return out
}
