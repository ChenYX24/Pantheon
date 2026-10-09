package config

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestHomeConfigDefaultsAndPrecedence(t *testing.T) {
	old, set := os.LookupEnv("VIBEPANEL_HOME_NOTIFY")
	if err := os.Unsetenv("VIBEPANEL_HOME_NOTIFY"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if set {
			_ = os.Setenv("VIBEPANEL_HOME_NOTIFY", old)
		} else {
			_ = os.Unsetenv("VIBEPANEL_HOME_NOTIFY")
		}
	})
	home, _ := os.UserHomeDir()
	if Default().CyxHome != filepath.Join(home, ".cyx") || Default().HomeNotify != "off" {
		t.Fatal("defaults")
	}
	args := []string{"--data-dir", t.TempDir(), "--addr", "127.0.0.1:29876", "--tmux-socket", "home-fixture", "--isolation", "off", "--development"}
	c, err := Load(args, io.Discard)
	if err != nil || c.HomeNotify != "dry_run" {
		t.Fatalf("development: %+v %v", c, err)
	}
	t.Setenv("VIBEPANEL_HOME_NOTIFY", "off")
	t.Setenv("VIBEPANEL_CYX_HOME", t.TempDir())
	t.Setenv("VIBEPANEL_HOME_PUBLIC_URL", "https://panel.test")
	c, err = Load(args, io.Discard)
	if err != nil || c.HomeNotify != "off" || c.CyxHome != os.Getenv("VIBEPANEL_CYX_HOME") || c.HomePublicURL != "https://panel.test" {
		t.Fatalf("environment: %+v %v", c, err)
	}
	c, err = Load(append(args, "--home-notify", "send", "--home-public-url", ""), io.Discard)
	if err != nil || c.HomeNotify != "send" || c.HomePublicURL != "" {
		t.Fatalf("flags: %+v %v", c, err)
	}
	for _, flags := range [][]string{{"--home-notify", "bad"}, {"--cyx-home", ""}, {"--home-public-url", "javascript:alert(1)"}, {"--home-public-url", "https://user:pass@panel.test"}} {
		if _, err := Load(flags, io.Discard); err == nil {
			t.Fatalf("accepted %v", flags)
		}
	}
}

func TestHomeAgentScopeConfig(t *testing.T) {
	if Default().AgentScope != "auto" {
		t.Fatal("default")
	}
	t.Setenv("VIBEPANEL_AGENT_SCOPE", "off")
	c, err := Load(nil, io.Discard)
	if err != nil || c.AgentScope != "off" {
		t.Fatalf("env: %s %v", c.AgentScope, err)
	}
	c, err = Load([]string{"--agent-scope", "auto"}, io.Discard)
	if err != nil || c.AgentScope != "auto" {
		t.Fatalf("flag: %s %v", c.AgentScope, err)
	}
	if _, err = Load([]string{"--agent-scope", "invalid"}, io.Discard); err == nil {
		t.Fatal("invalid scope")
	}
}
