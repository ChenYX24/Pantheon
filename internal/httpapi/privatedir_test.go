package httpapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The socket directory is used only when it is this user's and private:
// a symlink, somebody else's directory or an open mode is refused rather
// than made to fit, because a socket in a directory another account
// controls is that account's socket.
func TestTheSocketDirectoryMustBeOursAndPrivate(t *testing.T) {
	base := t.TempDir()
	fresh := filepath.Join(base, "fresh")
	if err := ownedPrivateDir(fresh); err != nil {
		t.Fatalf("a fresh directory: %v", err)
	}
	if info, _ := os.Stat(fresh); info.Mode().Perm() != 0o700 {
		t.Errorf("made with %v", info.Mode().Perm())
	}
	if err := ownedPrivateDir(fresh); err != nil {
		t.Errorf("the same directory again: %v", err)
	}
	open := filepath.Join(base, "open")
	if err := os.Mkdir(open, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ownedPrivateDir(open); err == nil || !strings.Contains(err.Error(), "readable by others") {
		t.Errorf("a 0755 directory: %v", err)
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(fresh, link); err != nil {
		t.Fatal(err)
	}
	if err := ownedPrivateDir(link); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Errorf("a symlink to a good directory: %v", err)
	}
	file := filepath.Join(base, "file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ownedPrivateDir(file); err == nil {
		t.Error("a file was accepted as a directory")
	}
}
