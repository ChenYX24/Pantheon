package hooks

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func claudeHome(t *testing.T, settings string) (path, script string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	path = filepath.Join(dir, ".claude", "settings.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if settings != "" {
		if err := os.WriteFile(path, []byte(settings), 0600); err != nil {
			t.Fatal(err)
		}
	}
	script, err := InstallScript(filepath.Join(dir, "hooks"))
	if err != nil {
		t.Fatal(err)
	}
	return path, script
}

func TestTheStatusLineIsInstalledBesideTheRestAndRemovedAlone(t *testing.T) {
	path, script := claudeHome(t, `{"theme":"dark","hooks":{"Stop":[{"hooks":[{"type":"command","command":"my-own"}]}]}}`)
	st, err := InstallClaudeQuota(script)
	if err != nil || st.ClaudeQuota != StatusLineOurs || !st.ClaudeQuotaCurrent {
		t.Fatalf("%+v %v", st, err)
	}
	b, _ := os.ReadFile(path)
	if !strings.Contains(string(b), `"command": "`+script+` quota"`) || !strings.Contains(string(b), "my-own") || !strings.Contains(string(b), `"theme": "dark"`) {
		t.Fatal(string(b))
	}
	again, _ := InstallClaudeQuota(script)
	if after, _ := os.ReadFile(path); string(after) != string(b) || again.ClaudeQuota != StatusLineOurs {
		t.Fatal("a second install rewrote the file")
	}
	st, err = UninstallClaudeQuota(script)
	if err != nil || st.ClaudeQuota != StatusLineNone {
		t.Fatalf("%+v %v", st, err)
	}
	b, _ = os.ReadFile(path)
	if strings.Contains(string(b), "statusLine") || !strings.Contains(string(b), "my-own") {
		t.Fatal(string(b))
	}
}

// One status line per machine, and it may be somebody's own: install refuses
// rather than replacing it, and remove leaves it where it is.
func TestSomebodysOwnStatusLineIsNeverReplacedOrRemoved(t *testing.T) {
	own := `{"statusLine":{"type":"command","command":"~/bin/my-line.sh"}}`
	path, script := claudeHome(t, own)
	if st, _ := Inspect(script); st.ClaudeQuota != StatusLineOther {
		t.Fatalf("%+v", st)
	}
	if _, err := InstallClaudeQuota(script); !errors.Is(err, ErrStatusLineTaken) {
		t.Fatalf("install over someone's status line: %v", err)
	}
	if _, err := UninstallClaudeQuota(script); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != own {
		t.Fatalf("their file changed: %s", b)
	}
}

// A panel moved to another data directory still owns the line an earlier one
// wrote: Inspect says so and does not call it current.
func TestAnEarlierPanelsStatusLineIsOursButNotCurrent(t *testing.T) {
	_, script := claudeHome(t, `{"statusLine":{"type":"command","command":"/old/data/hooks/vibepanel-report.sh quota"}}`)
	st, _ := Inspect(script)
	if st.ClaudeQuota != StatusLineOurs || st.ClaudeQuotaCurrent {
		t.Fatalf("%+v", st)
	}
	if st, err := InstallClaudeQuota(script); err != nil || !st.ClaudeQuotaCurrent {
		t.Fatalf("reinstall did not re-point it: %+v %v", st, err)
	}
}

func TestNoSettingsFileReadsAsNoStatusLine(t *testing.T) {
	_, script := claudeHome(t, "")
	st, err := Inspect(script)
	if err != nil || st.ClaudeQuota != StatusLineNone || st.ClaudeQuotaSnippet == "" {
		t.Fatalf("%+v %v", st, err)
	}
}

// The reporter as a status line: it must print nothing, return at once, send
// only documents with limits, and send at most one in fifteen seconds.
func TestTheQuotaReporterIsQuietQuickAndThrottled(t *testing.T) {
	dir := t.TempDir()
	script, err := InstallScript(dir)
	if err != nil {
		t.Fatal(err)
	}
	calls := filepath.Join(dir, "calls")
	curl := "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$CALLS\"\n"
	if err := os.WriteFile(filepath.Join(dir, "curl"), []byte(curl), 0700); err != nil {
		t.Fatal(err)
	}
	run := func(doc string) string {
		cmd := exec.Command(script, SignalQuota)
		cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "CALLS="+calls, "XDG_RUNTIME_DIR="+dir,
			"VIBEPANEL_SESSION_ID=abc123", "VIBEPANEL_TOKEN=fixture", "VIBEPANEL_URL=http://fixture.invalid")
		cmd.Stdin = strings.NewReader(doc)
		start := time.Now()
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		if time.Since(start) > 2*time.Second {
			t.Fatal("status line waited")
		}
		return string(out)
	}
	sent := func() int {
		deadline := time.Now().Add(2 * time.Second)
		for {
			b, _ := os.ReadFile(calls)
			n := strings.Count(string(b), "/api/hook/state?")
			if n > 0 || time.Now().After(deadline) {
				return n
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	if out := run(`{"session_id":"x","context_window":{}}`); out != "" {
		t.Fatalf("printed %q", out)
	}
	time.Sleep(200 * time.Millisecond)
	if b, _ := os.ReadFile(calls); len(b) != 0 {
		t.Fatalf("a document without limits was sent: %s", b)
	}
	doc := `{"rate_limits":{"five_hour":{"used_percentage":3,"resets_at":1793037000}}}`
	if out := run(doc); out != "" {
		t.Fatalf("printed %q", out)
	}
	if sent() != 1 {
		t.Fatal("the first document with limits was not sent")
	}
	b, _ := os.ReadFile(calls)
	if !strings.Contains(string(b), "&state=&source=&signal="+SignalQuota) || !strings.Contains(string(b), `"rate_limits"`) {
		t.Fatalf("script's signal/body drifted from the server: %s", b)
	}
	run(doc)
	time.Sleep(200 * time.Millisecond)
	if b, _ := os.ReadFile(calls); strings.Count(string(b), "/api/hook/state?") != 1 {
		t.Fatal("a second document inside fifteen seconds was sent")
	}
	cmd := exec.Command(script, SignalQuota)
	cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "CALLS="+calls, "XDG_RUNTIME_DIR="+dir,
		"VIBEPANEL_SESSION_ID=../../etc/x", "VIBEPANEL_TOKEN=fixture", "VIBEPANEL_URL=http://fixture.invalid")
	cmd.Stdin = strings.NewReader(doc)
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	if b, _ := os.ReadFile(calls); strings.Count(string(b), "/api/hook/state?") != 1 {
		t.Fatal("a session id that is not an id named a stamp file and was sent")
	}
}
