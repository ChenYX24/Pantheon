package parthenon

import (
	"os"
	"reflect"
	"testing"
)

func TestHomeAgentScopeArgv(t *testing.T) {
	lookup := func(string) (string, error) { return "/usr/bin/systemd-run", nil }
	stat := func(path string) (os.FileInfo, error) {
		if path != "/fixture/bus" && path != "/run/user/123/bus" {
			t.Fatalf("wrong bus %s", path)
		}
		return nil, nil
	}
	args := []string{"exec", "--sandbox", "read-only", "-"}
	expected := append([]string{"--user", "--scope", "--quiet", "--collect", "-p", "MemoryMax=1200M", "-p", "CPUQuota=100%", "--nice=10", "--", "codex"}, args...)
	for _, runtime := range []string{"/fixture", ""} {
		program, argv, env := agentCommand("auto", "codex", args, runtime, 123, lookup, stat)
		if runtime == "" {
			runtime = "/run/user/123"
		}
		if program != "/usr/bin/systemd-run" || !reflect.DeepEqual(argv, expected) || !reflect.DeepEqual(env, []string{"XDG_RUNTIME_DIR=" + runtime, "DBUS_SESSION_BUS_ADDRESS=unix:path=" + runtime + "/bus"}) {
			t.Fatalf("%s %v %v", program, argv, env)
		}
	}
	for _, mode := range []string{"off", "auto"} {
		program, argv, env := agentCommand(mode, "codex", args, "/fixture", 123, lookup, func(string) (os.FileInfo, error) { return nil, os.ErrNotExist })
		if program != "codex" || !reflect.DeepEqual(argv, args) || len(env) != 0 {
			t.Fatal("fallback", program, argv, env)
		}
	}
	program, _, _ := agentCommand("auto", "codex", args, "/fixture", 123, func(string) (string, error) { return "", os.ErrNotExist }, stat)
	if program != "codex" {
		t.Fatal("missing systemd fallback")
	}
}

func TestHomeModelCatalog(t *testing.T) {
	got := modelCatalog([]Executor{{Harness: "claude", Installed: true}, {Harness: "codex", Model: "custom", Source: "Codex config"}}, []byte("[tui.model_availability_nux]\n\"gpt-6.1-sol\" = true\n'other.model' = true\ncustom = false\n[next]\nignored = true\n"))
	if got[0].Default != "claude-opus-5-5" || got[0].Source != "built-in default" || !got[0].Installed {
		t.Fatalf("%+v", got[0])
	}
	if got[1].Default != "custom" || got[1].Source != "Codex config" || !reflect.DeepEqual(got[1].Models, []string{"custom", "gpt-6-astra", "gpt-6.1-sol", "other.model"}) {
		t.Fatalf("%+v", got[1])
	}
}
