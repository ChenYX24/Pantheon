package hooks

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/session"
)

func TestPreCompactSignalDocument(t *testing.T) {
	if session.State(SignalPreCompact).Valid() || events["PreCompact"] != SignalPreCompact {
		t.Fatal("PreCompact must be a signal, not a displayed state")
	}
	for _, tc := range []struct {
		body string
		want bool
	}{
		{`{"hook_event_name":"PreCompact","trigger":"auto"}`, true},
		{`{"hook_event_name":"PreCompact","trigger":"manual","extra":123}`, true},
		{`{"hook_event_name":"PreCompact"}`, false},
		{`{"hook_event_name":"PreCompact","trigger":"new-kind"}`, false},
		{`{"hook_event_name":"Stop","trigger":"auto"}`, false},
		{`{"trigger":"auto"}`, false}, {`not JSON`, false},
	} {
		if got := CompactionImminent([]byte(tc.body)); got != tc.want {
			t.Errorf("%s: %v", tc.body, got)
		}
	}
}

func TestPreCompactInstallMergeAndRemove(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	path := filepath.Join(dir, ".claude", "settings.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	user := `{"hooks":{"PreCompact":[{"hooks":[{"type":"command","command":"my-own-compact-hook"}]}]}}`
	if err := os.WriteFile(path, []byte(user), 0600); err != nil {
		t.Fatal(err)
	}
	script, err := InstallScript(filepath.Join(dir, "hooks"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InstallClaude(script); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(path)
	if !strings.Contains(string(first), "precompact") || !strings.Contains(string(first), "my-own-compact-hook") {
		t.Fatal(string(first))
	}
	if _, err := InstallClaude(script); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(path)
	if string(first) != string(second) {
		t.Fatal("reinstall changed the merged PreCompact hook")
	}
	if _, err := UninstallClaude(script); err != nil {
		t.Fatal(err)
	}
	removed, _ := os.ReadFile(path)
	if strings.Contains(string(removed), marker) || !strings.Contains(string(removed), "my-own-compact-hook") {
		t.Fatal(string(removed))
	}
}

func TestPreCompactReporterDoesNotWaitForHTTP(t *testing.T) {
	dir := t.TempDir()
	script, err := InstallScript(dir)
	if err != nil {
		t.Fatal(err)
	}
	args, release, done := filepath.Join(dir, "args"), filepath.Join(dir, "release"), filepath.Join(dir, "done")
	curl := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$ARGS\"\nwhile [ ! -f \"$RELEASE\" ]; do sleep 0.01; done\nprintf done > \"$DONE\"\n"
	if err := os.WriteFile(filepath.Join(dir, "curl"), []byte(curl), 0700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(script, SignalPreCompact)
	cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "ARGS="+args, "RELEASE="+release, "DONE="+done,
		"VIBEPANEL_SESSION_ID=fixture", "VIBEPANEL_TOKEN=fixture", "VIBEPANEL_URL=http://fixture.invalid")
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"PreCompact","trigger":"auto"}`)
	returned := make(chan error, 1)
	go func() { returned <- cmd.Run() }()
	select {
	case err := <-returned:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		_ = os.WriteFile(release, nil, 0600)
		t.Fatal("reporter waited for HTTP during compaction")
	}
	_ = os.WriteFile(release, nil, 0600)
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(done); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background reporter did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}
	data, _ := os.ReadFile(args)
	if !strings.Contains(string(data), "&state=&source=&signal="+SignalPreCompact) || !strings.Contains(string(data), `"trigger":"auto"`) {
		t.Fatal("script's signal/body drifted from the server", string(data))
	}
}

func TestBackgroundWorkInventory(t *testing.T) {
	for _, tc := range []struct {
		body           string
		running, known bool
	}{
		{`{"hook_event_name":"Stop","background_tasks":[{"type":"shell","status":"running"}]}`, true, true},
		{`{"hook_event_name":"Stop","background_tasks":[{"type":"subagent","status":"pending"}]}`, true, true},
		{`{"hook_event_name":"Stop","background_tasks":[{"status":"completed"}]}`, false, true},
		{`{"hook_event_name":"Stop","background_tasks":[]}`, false, true},
		{`{"hook_event_name":"Stop"}`, false, false},
		{`{"hook_event_name":"Stop","agent_id":"child","background_tasks":[]}`, false, false},
		{`{"hook_event_name":"PreToolUse","background_tasks":[]}`, false, false},
	} {
		if running, known := BackgroundWork([]byte(tc.body)); running != tc.running || known != tc.known {
			t.Errorf("%s: %v %v", tc.body, running, known)
		}
	}
}
