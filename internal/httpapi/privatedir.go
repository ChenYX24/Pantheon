package httpapi

import (
	"fmt"
	"os"
	"syscall"
)

// ownedPrivateDir makes dir if it is missing and then insists on what the
// code around it assumes: a real directory, this user's, with no bits for
// anybody else. MkdirAll on its own accepts an existing directory of any
// owner and mode and follows a symlink, so on a shared machine another
// account could pre-create /tmp/vibepanel-<uid> and the panel would dial
// a socket it had put there -- with the per-start proxy secret and the
// caller's name on every request (audit 04-F2). A directory that fails the
// check is refused, with the reason, rather than made to fit.
func ownedPrivateDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s is a symlink; the panel only uses a directory it made", dir)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}
	if st, ok := info.Sys().(*syscall.Stat_t); ok && int(st.Uid) != os.Getuid() {
		return fmt.Errorf("%s belongs to uid %d, not to this user; remove it or set XDG_RUNTIME_DIR", dir, st.Uid)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("%s is readable by others (%v); the panel needs it 0700", dir, info.Mode().Perm())
	}
	return nil
}
