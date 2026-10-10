package parthenon

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
)

type agentScopeKey struct{}

func WithAgentScope(ctx context.Context, mode string) context.Context {
	return context.WithValue(ctx, agentScopeKey{}, mode)
}

func agentCommand(mode, harness string, args []string, runtime string, uid int, lookPath func(string) (string, error), stat func(string) (os.FileInfo, error)) (string, []string, []string) {
	if mode == "off" {
		return harness, args, nil
	}
	program, err := lookPath("systemd-run")
	if err != nil {
		return harness, args, nil
	}
	if runtime == "" {
		runtime = filepath.Join("/run/user", strconv.Itoa(uid))
	}
	bus := filepath.Join(runtime, "bus")
	if _, err := stat(bus); err != nil {
		return harness, args, nil
	}
	// The scope belongs to the user manager, outside the panel's MemoryMax.
	argv := []string{"--user", "--scope", "--quiet", "--collect", "-p", "MemoryMax=1200M", "-p", "CPUQuota=100%", "--nice=10", "--", harness}
	return program, append(argv, args...), []string{"XDG_RUNTIME_DIR=" + runtime, "DBUS_SESSION_BUS_ADDRESS=unix:path=" + bus}
}
