package usage

import (
	"os"
	"path/filepath"
	"testing"
)

// An agent that is not on this machine is absent, which the panel does not warn
// about; one that is here and cannot be read is not, and it does. The two
// read the same on the page if Absent is not set exactly.
func TestAnAgentThatIsNotInstalledIsAbsentNotAProblem(t *testing.T) {
	home := t.TempDir()
	s := DefaultScanner(home)

	// Nothing installed: every root missing.
	for _, tool := range []Tool{ToolHermes, ToolPi, ToolOpencode} {
		_, src, err := s.Walk(tool)
		if err != nil {
			t.Fatal(err)
		}
		if src.Found || !src.Absent {
			t.Errorf("%s with no directory: found=%v absent=%v, want absent", tool, src.Found, src.Absent)
		}
	}

	// Installed, never run: the directory is there, the ledger is not.
	if err := os.MkdirAll(filepath.Join(home, ".hermes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, src, _ := s.Walk(ToolHermes); src.Found || !src.Absent {
		t.Errorf("hermes with a directory and no database: found=%v absent=%v, want absent", src.Found, src.Absent)
	}

	// There and unreadable: a real problem, and a warning.
	if os.Getuid() == 0 {
		t.Skip("root reads everything; the unreadable case cannot be made")
	}
	locked := filepath.Join(home, ".pi")
	if err := os.MkdirAll(filepath.Join(locked, "agent", "sessions"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(locked, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })
	_, src, _ := s.Walk(ToolPi)
	if src.Absent || src.Found || src.Problem == "" {
		t.Errorf("pi behind a directory it cannot enter: found=%v absent=%v problem=%q; want a problem, not absent",
			src.Found, src.Absent, src.Problem)
	}
}
