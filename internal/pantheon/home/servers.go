package home

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"
)

const BoardStaleAfterSeconds = 180

type ServerGPU struct {
	Index          int      `json:"index"`
	Name           string   `json:"name"`
	MemoryTotalMib *float64 `json:"memoryTotalMib"`
	MemoryUsedMib  *float64 `json:"memoryUsedMib"`
	UtilizationPct *float64 `json:"utilizationPct"`
	TemperatureC   *float64 `json:"temperatureC"`
	PowerW         *float64 `json:"powerW"`
	MIGMode        string   `json:"migMode"`
	Observation    string   `json:"observation"`
}

type ServerStatus struct {
	ID            string      `json:"id"`
	Alias         string      `json:"alias"`
	Group         string      `json:"group"`
	Label         string      `json:"label"`
	State         string      `json:"state"`
	Reachability  string      `json:"reachability"`
	Telemetry     string      `json:"telemetry"`
	LastSuccessAt *string     `json:"lastSuccessAt"`
	LastMetricsAt *string     `json:"lastMetricsAt"`
	AgeSeconds    *float64    `json:"ageSeconds"`
	ErrorCode     *string     `json:"errorCode"`
	GPUs          []ServerGPU `json:"gpus"`
	ResourceID    *string     `json:"resourceId"`
}

type BoardStatus struct {
	Available         bool    `json:"available"`
	CollectedAt       *string `json:"collectedAt"`
	StaleAfterSeconds int     `json:"staleAfterSeconds"`
	URL               string  `json:"url"`
}

type Servers struct {
	Servers    []ServerStatus `json:"servers"`
	SSHAliases []string       `json:"sshAliases"`
	Board      BoardStatus    `json:"board"`
}

func UnknownServer(id, alias string) ServerStatus {
	return ServerStatus{ID: id, Alias: alias, Label: alias, State: "unknown", Reachability: "unknown", Telemetry: "unknown", GPUs: []ServerGPU{}}
}

// Read only Host names and Include paths. Invoking `ssh -G` would also execute
// Match exec directives while rendering a page, violating explicit-only checks.
func SSHAliases(configPath string) ([]string, error) {
	seenFiles, aliases := map[string]bool{}, map[string]bool{}
	base := filepath.Dir(configPath)
	var read func(string, int) error
	read = func(path string, depth int) error {
		if depth > 16 || len(seenFiles) >= 128 {
			return errors.New("SSH Include limit exceeded")
		}
		path = filepath.Clean(path)
		if seenFiles[path] {
			return nil
		}
		seenFiles[path] = true
		file, err := os.Open(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() || info.Size() > MaxFileSize {
			return errors.New("SSH config is not a bounded regular file")
		}
		scanner := bufio.NewScanner(io.LimitReader(file, MaxFileSize+1))
		scanner.Buffer(make([]byte, 4096), MaxFileSize)
		for scanner.Scan() {
			fields := sshConfigFields(scanner.Text())
			if len(fields) < 2 {
				continue
			}
			switch strings.ToLower(fields[0]) {
			case "host":
				for _, alias := range fields[1:] {
					if validSSHAlias(alias) {
						aliases[alias] = true
					}
				}
			case "include":
				for _, pattern := range fields[1:] {
					if strings.HasPrefix(pattern, "~/") {
						pattern = filepath.Join(filepath.Dir(base), pattern[2:])
					}
					if !filepath.IsAbs(pattern) {
						pattern = filepath.Join(base, pattern)
					}
					matches, err := filepath.Glob(pattern)
					if err != nil {
						return err
					}
					for _, match := range matches {
						if err := read(match, depth+1); err != nil {
							return err
						}
					}
				}
			}
		}
		return scanner.Err()
	}
	err := read(configPath, 0)
	out := []string{}
	for alias := range aliases {
		out = append(out, alias)
	}
	sort.Strings(out)
	return out, err
}

func validSSHAlias(alias string) bool {
	if alias == "" || strings.HasPrefix(alias, "-") || strings.ContainsAny(alias, "*?![]/\\@=\x00") {
		return false
	}
	for _, c := range alias {
		if unicode.IsSpace(c) || unicode.IsControl(c) {
			return false
		}
	}
	return true
}

func sshConfigFields(line string) []string {
	var out []string
	var word strings.Builder
	var quote rune
	escaped := false
	flush := func() {
		if word.Len() > 0 {
			out = append(out, word.String())
			word.Reset()
		}
	}
	for _, c := range line {
		if escaped {
			word.WriteRune(c)
			escaped = false
			continue
		}
		if c == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				word.WriteRune(c)
			}
			continue
		}
		if c == '"' || c == '\'' {
			quote = c
			continue
		}
		if c == '#' {
			break
		}
		if unicode.IsSpace(c) || c == '=' && len(out) == 0 {
			flush()
		} else {
			word.WriteRune(c)
		}
	}
	if quote != 0 || escaped {
		return nil
	}
	flush()
	return out
}

// Decode into an explicit projection rather than forwarding snapshot maps.
// New collector fields (addresses, identities, UUIDs, stderr) stay private.
func ReadBoardSnapshot(path, boardURL string, now time.Time) ([]ServerStatus, BoardStatus) {
	board := BoardStatus{StaleAfterSeconds: BoardStaleAfterSeconds, URL: boardURL}
	empty := []ServerStatus{}
	file, err := os.Open(path)
	if err != nil {
		return empty, board
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4<<20 {
		return empty, board
	}
	data, err := io.ReadAll(io.LimitReader(file, (4<<20)+1))
	if err != nil || len(data) > 4<<20 {
		return empty, board
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(data, &raw) != nil {
		return empty, board
	}
	var version int
	if value, ok := raw["version"]; ok && (json.Unmarshal(value, &version) != nil || version != 1) {
		return empty, board
	}
	collected := boardString(raw, "collectedAt")
	if _, err := time.Parse(time.RFC3339Nano, collected); err != nil {
		return empty, board
	}
	var nodes []map[string]json.RawMessage
	if json.Unmarshal(raw["nodes"], &nodes) != nil || nodes == nil {
		return empty, board
	}
	servers := []ServerStatus{}
	for _, node := range nodes {
		id := boardString(node, "id")
		if id == "" {
			return empty, board
		}
		server := UnknownServer(id, boardString(node, "alias"))
		server.Group, server.Label = boardString(node, "group"), boardString(node, "label")
		server.Reachability, server.Telemetry = boardString(node, "reachability"), boardString(node, "telemetry")
		server.LastSuccessAt = boardTimestamp(node, "lastSuccessAt")
		server.LastMetricsAt = boardTimestamp(node, "lastMetricsAt")
		server.State = boardString(node, "state")
		if code := boardString(node, "errorCode"); code != "" {
			server.ErrorCode = &code
		}
		if server.LastMetricsAt != nil {
			at, _ := time.Parse(time.RFC3339Nano, *server.LastMetricsAt)
			age := max(0, now.Sub(at).Seconds())
			server.AgeSeconds = &age
		}
		switch {
		case server.Reachability == "disconnected" || server.State == "disconnected":
			server.State = "disconnected"
		case server.Telemetry == "unsupported" || server.State == "unsupported":
			server.State = "unsupported"
		case server.LastMetricsAt == nil:
			server.State = "unknown"
		case *server.AgeSeconds > BoardStaleAfterSeconds:
			server.State = "stale"
		case server.State != "stale" && server.State != "unknown":
			server.State = "fresh"
		}
		var gpus []map[string]json.RawMessage
		if value, ok := node["gpus"]; ok && json.Unmarshal(value, &gpus) != nil {
			return empty, board
		}
		for _, gpu := range gpus {
			item := ServerGPU{Name: boardString(gpu, "name"), MemoryTotalMib: boardNumber(gpu, "memoryTotalMib"), MemoryUsedMib: boardNumber(gpu, "memoryUsedMib"), UtilizationPct: boardNumber(gpu, "utilizationPct"), TemperatureC: boardNumber(gpu, "temperatureC"), PowerW: boardNumber(gpu, "powerW"), MIGMode: boardString(gpu, "migMode"), Observation: "unknown"}
			_ = json.Unmarshal(gpu["index"], &item.Index)
			// Observations belong to the board's policy; Pantheon only expires
			// them and never turns a metric threshold into an allocation grant.
			if observation := boardString(gpu, "observation"); server.State == "fresh" && (observation == "low_usage" || observation == "usage_observed") {
				item.Observation = observation
			}
			server.GPUs = append(server.GPUs, item)
		}
		servers = append(servers, server)
	}
	board.Available, board.CollectedAt = true, &collected
	return servers, board
}

func boardValue(raw map[string]json.RawMessage, key string) json.RawMessage {
	if value, ok := raw[key]; ok {
		return value
	}
	var snake strings.Builder
	for _, c := range key {
		if c >= 'A' && c <= 'Z' {
			snake.WriteByte('_')
			c += 'a' - 'A'
		}
		snake.WriteRune(c)
	}
	return raw[snake.String()]
}

func boardString(raw map[string]json.RawMessage, key string) string {
	var value string
	_ = json.Unmarshal(boardValue(raw, key), &value)
	return value
}

func boardTimestamp(raw map[string]json.RawMessage, key string) *string {
	value := boardString(raw, key)
	if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
		return nil
	}
	return &value
}

func boardNumber(raw map[string]json.RawMessage, key string) *float64 {
	var value *float64
	if json.Unmarshal(boardValue(raw, key), &value) != nil {
		return nil
	}
	return value
}
