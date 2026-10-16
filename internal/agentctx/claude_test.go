package agentctx

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type fakeProc struct {
	names map[int]string
	kids  map[int][]int
	walks int
}

func (p *fakeProc) Comm(pid int) string    { return p.names[pid] }
func (p *fakeProc) FDTargets(int) []string { return nil }
func (p *fakeProc) Children(pid int) []int { p.walks++; return p.kids[pid] }

func TestClaudePIDMapping(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	for _, custom := range []bool{false, true} {
		t.Run(fmt.Sprint(custom), func(t *testing.T) {
			config := ""
			if custom {
				config = filepath.Join(home, "account")
			}
			t.Setenv("CLAUDE_CONFIG_DIR", config)
			dir := claudeConfigDir(os.Getenv("HOME"), os.Getenv("CLAUDE_CONFIG_DIR"), "/project")
			proc := &fakeProc{names: map[int]string{10: "bash", 20: "claude"}, kids: map[int][]int{10: {20}}}
			configs := 0
			f := ClaudeFinder{Proc: proc, ConfigDir: func(int) string { configs++; return dir }}
			record := filepath.Join(dir, "sessions", "20.json")
			writeRecord := func(id string) {
				put(t, record, `{"pid":20,"sessionId":"`+id+`","cwd":"/home/cyx/My_project.中","startedAt":1,"version":"fixture","kind":"cli"}`)
			}
			writeRecord("first")
			want := filepath.Join(dir, "projects", "-home-cyx-My-project--", "first.jsonl")
			put(t, want, claudeLine(1000))
			if got := f.Find(10); got != want {
				t.Fatalf("mapped path = %q, want %q", got, want)
			}
			walks := proc.walks
			f.Find(10)
			if configs != 1 || walks != proc.walks {
				t.Fatalf("cached pid/config walked again: configs=%d walks=%d", configs, proc.walks)
			}
			writeRecord("second")
			if got := f.Find(10); got != filepath.Join(filepath.Dir(want), "second.jsonl") {
				t.Fatalf("/clear did not change path: %q", got)
			}
			var w Watcher
			if _, ok := w.Read("s", f.Find(10), Claude, time.Now()); ok {
				t.Fatal("missing transcript had usage")
			}
			for _, invalid := range []string{`{`, `{"pid":21,"sessionId":"first","cwd":"/project"}`, `{"pid":20,"sessionId":"../escape","cwd":"/project"}`} {
				put(t, record, invalid)
				if got := f.Find(10); got != "" {
					t.Fatalf("invalid record mapped to %q", got)
				}
			}
			writeRecord("first")
			delete(proc.names, 20)
			if got := f.Find(10); got != "" {
				t.Fatalf("dead pid mapped to %q", got)
			}
			proc.names[20] = "claude"
			f.Find(10)
			f.Retain(nil)
			if len(f.panes) != 0 {
				t.Fatal("forgotten pane retained its pid")
			}
			if err := os.Remove(record); err != nil {
				t.Fatal(err)
			}
			if got := f.Find(20); got != "" {
				t.Fatalf("missing record mapped to %q", got)
			}
		})
	}
}

func TestClaudeConfigDirectory(t *testing.T) {
	for _, tc := range []struct{ home, config, cwd, want string }{
		{"/home/test", "", "/project", "/home/test/.claude"},
		{"/home/test", "/account", "/project", "/account"},
		{"/home/test", "relative", "/project", "/project/relative"},
		{"/home/test", "relative", "", ""},
		{"", "", "", ""},
	} {
		if got := claudeConfigDir(tc.home, tc.config, tc.cwd); got != tc.want {
			t.Fatalf("config(%+v) = %q", tc, got)
		}
	}
}

func TestClaudePIDWalkIsBounded(t *testing.T) {
	p := &fakeProc{names: map[int]string{1: "bash"}, kids: map[int][]int{1: {1, 2}, 2: {1}}}
	f := ClaudeFinder{Proc: p, ConfigDir: func(int) string { t.Fatal("unexpected config lookup"); return "" }}
	if got := f.Find(1); got != "" || p.walks != 2 {
		t.Fatalf("cyclic process tree: %q, %d walks", got, p.walks)
	}
}
