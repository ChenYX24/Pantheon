package agentctx

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jiangmuran/vibepanel/internal/codexlog"
)

// ClaudeFinder caches the Claude pid and config directory beneath a pane pid.
// Only the poller calls it. The tiny session record is re-read to catch /clear
// and --resume even when the old transcript stopped growing.
type ClaudeFinder struct {
	Proc      codexlog.Proc
	ConfigDir func(pid int) string
	panes     map[int]claudeProcess
}

type claudeProcess struct {
	pid int
	dir string
}

func (f *ClaudeFinder) Find(panePID int) string {
	if panePID <= 0 {
		return ""
	}
	proc := f.Proc
	if proc == nil {
		proc = codexlog.SystemProc()
	}
	if f.panes == nil {
		f.panes = map[int]claudeProcess{}
	}
	p, cached := f.panes[panePID]
	if !cached || !strings.HasPrefix(proc.Comm(p.pid), "claude") || proc.Comm(panePID) == "" {
		delete(f.panes, panePID)
		p = claudeProcess{}
		type item struct{ pid, depth int }
		queue, seen := []item{{panePID, 0}}, map[int]bool{}
		for len(queue) > 0 && len(seen) < 64 {
			it := queue[0]
			queue = queue[1:]
			if seen[it.pid] {
				continue
			}
			seen[it.pid] = true
			if strings.HasPrefix(proc.Comm(it.pid), "claude") {
				dir := f.ConfigDir
				if dir == nil {
					dir = processConfigDir
				}
				p = claudeProcess{pid: it.pid, dir: dir(it.pid)}
				f.panes[panePID] = p
				break
			}
			if it.depth < 6 {
				for _, child := range proc.Children(it.pid) {
					queue = append(queue, item{child, it.depth + 1})
				}
			}
		}
	}
	if p.pid == 0 || p.dir == "" {
		return ""
	}
	b, err := readSmall(filepath.Join(p.dir, "sessions", strconv.Itoa(p.pid)+".json"), 16<<10)
	if err != nil {
		return ""
	}
	var record struct {
		PID       int    `json:"pid"`
		SessionID string `json:"sessionId"`
		CWD       string `json:"cwd"`
	}
	if json.Unmarshal(b, &record) != nil || record.PID != p.pid || !filepath.IsAbs(record.CWD) || !plainSessionID(record.SessionID) {
		return ""
	}
	slug := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			return r
		}
		return '-'
	}, record.CWD)
	// The watcher does the one transcript stat, so a missing file is unknown
	// without a second existence check on the idle path.
	return filepath.Join(p.dir, "projects", slug, record.SessionID+".jsonl")
}

func plainSessionID(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

func readSmall(path string, limit int) ([]byte, error) {
	f, err := safeOpen(path)
	if err != nil {
		return nil, err
	}
	defer f.Close() //nolint:errcheck // read-only
	buf := make([]byte, limit+1)
	n, err := f.ReadAt(buf, 0)
	if n > limit {
		return nil, io.ErrShortBuffer
	}
	if err != nil && err != io.EOF {
		return nil, err
	}
	return buf[:n], nil
}

func processConfigDir(pid int) string {
	// An account or launch profile can override the panel's environment. Only
	// these two keys are retained; credentials in environ never leave here.
	b, _ := readSmall(filepath.Join("/proc", strconv.Itoa(pid), "environ"), 1<<20)
	home, config := "", ""
	for _, pair := range bytes.Split(b, []byte{0}) {
		key, value, ok := bytes.Cut(pair, []byte{'='})
		if ok {
			switch string(key) {
			case "HOME":
				home = string(value)
			case "CLAUDE_CONFIG_DIR":
				config = string(value)
			}
		}
	}
	if len(b) == 0 {
		config = os.Getenv("CLAUDE_CONFIG_DIR")
		home, _ = os.UserHomeDir()
	}
	cwd, _ := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "cwd"))
	return claudeConfigDir(home, config, cwd)
}

func claudeConfigDir(home, config, cwd string) string {
	if config != "" {
		if filepath.IsAbs(config) {
			return config
		}
		if cwd != "" {
			return filepath.Join(cwd, config)
		}
		return ""
	}
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".claude")
}

func (f *ClaudeFinder) Retain(pids []int) {
	keep := make(map[int]bool, len(pids))
	for _, pid := range pids {
		keep[pid] = true
	}
	for pid := range f.panes {
		if !keep[pid] {
			delete(f.panes, pid)
		}
	}
}
