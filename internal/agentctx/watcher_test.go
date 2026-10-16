package agentctx

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func put(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
}

func appendLog(t *testing.T, path, data string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(data); err != nil {
		t.Fatal(err)
	}
}

func TestWatcherIncrementalAndUnchangedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "claude.jsonl")
	put(t, path, claudeLine(1000))
	opens, stats := 0, 0
	w := Watcher{
		open: func(path string) (*os.File, error) { opens++; return safeOpen(path) },
		stat: func(path string) (os.FileInfo, error) { stats++; return os.Stat(path) },
	}
	now := time.Now()
	u, ok := w.Read("s", path, Claude, now)
	if !ok || u.Used != 1500 {
		t.Fatalf("initial = %+v, %v", u, ok)
	}
	offset := w.tail["s"].offset
	for range 4 {
		if got, _ := w.Read("s", path, Claude, now.Add(time.Minute)); got != u {
			t.Fatalf("idle reading changed: %+v", got)
		}
	}
	if opens != 1 || stats != 5 || w.tail["s"].offset != offset {
		t.Fatalf("unchanged file: opens=%d stats=%d offset=%d", opens, stats, w.tail["s"].offset)
	}
	line := claudeLine(2000)
	appendLog(t, path, line[:len(line)-1])
	if got, _ := w.Read("s", path, Claude, now); got != u || w.tail["s"].offset != offset {
		t.Fatalf("partial line was consumed: %+v", got)
	}
	appendLog(t, path, "\n")
	if got, _ := w.Read("s", path, Claude, now); got.Used != 2500 {
		t.Fatalf("completed append = %+v", got)
	}
	w.Retain(nil)
	if len(w.tail) != 0 {
		t.Fatal("Retain kept a removed session")
	}
}

func TestWatcherResets(t *testing.T) {
	dir := t.TempDir()
	a, b := filepath.Join(dir, "a"), filepath.Join(dir, "b")
	put(t, a, claudeLine(1000))
	put(t, b, "no usage\n")
	var w Watcher
	w.Read("s", a, Claude, time.Now())
	if u, ok := w.Read("s", b, Claude, time.Now()); ok || u.Source != "" {
		t.Fatalf("path change retained previous conversation: %+v", u)
	}
	w.Read("s", a, Claude, time.Now())
	put(t, a, "\n")
	if u, ok := w.Read("s", a, Claude, time.Now()); ok || u.Source != "" {
		t.Fatalf("truncation retained previous conversation: %+v", u)
	}
	appendLog(t, a, codexLine(3000))
	if u, ok := w.Read("s", a, Codex, time.Now()); !ok || u.Used != 3000 {
		t.Fatalf("source reset = %+v, %v", u, ok)
	}
	if u, ok := w.Read("s", filepath.Join(dir, "missing"), Claude, time.Now()); ok || u.Source != "" {
		t.Fatalf("missing file = %+v, %v", u, ok)
	}
}

func TestWatcherSkipsOversizedLineAndDrainsBoundedReads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "log")
	put(t, path, claudeLine(1000))
	var w Watcher
	w.Read("s", path, Claude, time.Now())
	appendLog(t, path, strings.Repeat("x", maxRead+99)+claudeLine(900_000)+claudeLine(2000))
	if got, _ := w.Read("s", path, Claude, time.Now()); got.Used != 1500 {
		t.Fatalf("oversized line changed usage: %+v", got)
	}
	if got, _ := w.Read("s", path, Claude, time.Now()); got.Used != 2500 {
		t.Fatalf("did not resume after oversized line: %+v", got)
	}
	// The initial 256 KiB tail can start inside an enormous tool result too.
	var first Watcher
	if got, _ := first.Read("s", path, Claude, time.Now()); got.Used != 2500 {
		t.Fatalf("initial tail = %+v", got)
	}
}

func TestWatcherRejectsFIFOAndDirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fifo")
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	var w Watcher
	for _, path := range []string{path, dir} {
		if _, ok := w.Read("s", path, Claude, time.Now()); ok {
			t.Fatal("non-regular file had usage")
		}
	}
	// Swap a FIFO in after stat as well; open must still be non-blocking.
	regular := filepath.Join(dir, "regular")
	put(t, regular, claudeLine(1000))
	w.stat = func(string) (os.FileInfo, error) { return os.Stat(regular) }
	if _, ok := w.Read("s", path, Claude, time.Now()); ok {
		t.Fatal("raced FIFO had usage")
	}
}

func TestWatcherReplacementAndSameSizeRewrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "log")
	put(t, path, codexLine(1000))
	var w Watcher
	w.Read("s", path, Codex, time.Now())
	put(t, path, codexLine(2000))
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
	if u, _ := w.Read("s", path, Codex, time.Now()); u.Used != 2000 {
		t.Fatalf("same-size rewrite = %+v", u)
	}
	put(t, path+".new", codexLine(3000))
	if err := os.Rename(path+".new", path); err != nil {
		t.Fatal(err)
	}
	if u, _ := w.Read("s", path, Codex, time.Now()); u.Used != 3000 {
		t.Fatalf("replacement = %+v", u)
	}
}

func TestWatcherDrainsBacklogWithoutMoreAppends(t *testing.T) {
	path := filepath.Join(t.TempDir(), "log")
	put(t, path, codexLine(1000))
	var w Watcher
	w.Read("s", path, Codex, time.Now())
	appendLog(t, path, strings.Repeat("x\n", maxRead/2)+codexLine(2000))
	w.Read("s", path, Codex, time.Now())
	if u, _ := w.Read("s", path, Codex, time.Now()); u.Used != 2000 {
		t.Fatalf("unread bytes in unchanged file were stranded: %+v", u)
	}
}
