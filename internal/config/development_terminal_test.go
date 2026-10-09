package config

import (
	"io"
	"testing"
)

func TestDevelopmentTerminalIsExplicitAndCannotExecuteWorkflows(t *testing.T) {
	for _, tc := range []struct {
		name  string
		flags []string
		ok    bool
	}{
		{"manual", []string{"--development", "--development-terminal"}, true},
		{"without development", []string{"--development-terminal"}, false},
		{"planning", []string{"--planning-only", "--development-terminal"}, false},
		{"executor", []string{"--development", "--development-terminal", "--workflow-execute"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			args := []string{"--data-dir", t.TempDir(), "--addr", "127.0.0.1:29876", "--tmux-socket", "manual-fixture", "--isolation", "off"}
			_, err := Load(append(args, tc.flags...), io.Discard)
			if (err == nil) != tc.ok {
				t.Fatalf("Load: %v; want success=%v", err, tc.ok)
			}
		})
	}
}
