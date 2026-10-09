package parthenon

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type HarnessModels struct {
	Harness   string   `json:"harness"`
	Installed bool     `json:"installed"`
	Default   string   `json:"default"`
	Source    string   `json:"source"`
	Models    []string `json:"models"`
}

func Models() []HarnessModels {
	home, _ := os.UserHomeDir()
	config, _ := os.ReadFile(filepath.Join(home, ".codex", "config.toml"))
	return modelCatalog(Executors(), config)
}

func modelCatalog(executors []Executor, config []byte) []HarnessModels {
	builtins := map[string][]string{
		"claude": {"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"},
		"codex":  {"gpt-6-astra", "gpt-6.1-sol"},
	}
	out := []HarnessModels{}
	for _, e := range executors {
		m := HarnessModels{Harness: e.Harness, Installed: e.Installed, Default: e.Model, Source: e.Source, Models: []string{}}
		seen := map[string]bool{}
		add := func(value string) {
			if value != "" && !seen[value] {
				m.Models = append(m.Models, value)
				seen[value] = true
			}
		}
		add(e.Model)
		for _, value := range builtins[e.Harness] {
			add(value)
		}
		if e.Harness == "codex" {
			for _, value := range codexModelKeys(config) {
				add(value)
			}
		}
		if m.Default == "" && len(m.Models) > 0 {
			m.Default, m.Source = m.Models[0], "built-in default"
		}
		out = append(out, m)
	}
	return out
}

func codexModelKeys(config []byte) []string {
	out := []string{}
	key := regexp.MustCompile(`^\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=`)
	active := false
	for _, line := range strings.Split(string(config), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") {
			header, _, _ := strings.Cut(line, "]")
			active = strings.TrimSpace(strings.TrimPrefix(header, "[")) == "tui.model_availability_nux"
			continue
		}
		if active {
			if match := key.FindStringSubmatch(line); match != nil {
				value := match[1]
				if decoded, err := strconv.Unquote(value); err == nil {
					value = decoded
				} else {
					value = strings.Trim(value, "'")
				}
				out = append(out, value)
			}
		}
	}
	return out
}
