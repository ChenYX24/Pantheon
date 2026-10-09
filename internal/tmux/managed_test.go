package tmux

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"testing"
)

func TestExternallyManagedClientNeverStartsAServer(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux unavailable")
	}
	c := New(fmt.Sprintf("vp-managed-fixture-%d", os.Getpid()), t.TempDir())
	c.ExternallyManaged = true
	t.Cleanup(func() { _ = c.KillServer(context.Background()) })
	if !slices.Contains(c.args("new-session"), "-N") {
		t.Error("all client commands must forbid implicit server startup")
	}
	if err := c.EnsureServer(context.Background()); err == nil {
		t.Error("missing supervised server must fail closed")
	}
	if c.ServerRunning(context.Background()) {
		t.Error("client started a server in its own process group")
	}
}
