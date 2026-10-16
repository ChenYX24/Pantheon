package agentctx

import (
	"bytes"
	"io"
	"os"
	"sync"
	"syscall"
	"time"
)

const (
	initialTail = 256 << 10
	maxRead     = 4 << 20
)

// Watcher keeps bounded tails in memory. Call Read from the poller, never from
// a snapshot builder. The zero value is ready to use and concurrent calls are safe.
type Watcher struct {
	mu   sync.Mutex
	tail map[string]*tail
	stat func(string) (os.FileInfo, error)
	open func(string) (*os.File, error)
}

type tail struct {
	path, source string
	offset       int64
	info         os.FileInfo
	skipping     bool
	pending      bool
	last         Usage
}

func safeOpen(path string) (*os.File, error) {
	// A hook supplies the path. Stat alone does not close the race with a FIFO
	// or terminal swapped in before open; neither may block or own the poller.
	return os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOCTTY, 0)
}

func (w *Watcher) Read(id, path, source string, now time.Time) (Usage, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.tail == nil {
		w.tail = map[string]*tail{}
	}
	t := w.tail[id]
	if t == nil || t.path != path || t.source != source {
		t = &tail{path: path, source: source, offset: -1}
		w.tail[id] = t
	}
	if path == "" {
		return Usage{}, false
	}
	stat := w.stat
	if stat == nil {
		stat = os.Stat
	}
	info, err := stat(path)
	if err != nil || !info.Mode().IsRegular() {
		t.last, t.info, t.offset, t.skipping, t.pending = Usage{}, nil, -1, false, false
		return Usage{}, false
	}
	if t.info != nil && os.SameFile(t.info, info) && info.Size() == t.info.Size() && info.ModTime().Equal(t.info.ModTime()) && !t.pending {
		return t.last, t.last.Source != ""
	}
	open := w.open
	if open == nil {
		open = safeOpen
	}
	f, err := open(path)
	if err != nil {
		return Usage{}, false
	}
	defer f.Close() //nolint:errcheck // read-only
	info, err = f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return Usage{}, false
	}
	// A replacement or a rewrite of the same length is a new conversation,
	// just as a smaller file is. Never retain its predecessor's usage.
	if t.info != nil && (!os.SameFile(t.info, info) || info.Size() < t.info.Size() ||
		(info.Size() == t.info.Size() && !info.ModTime().Equal(t.info.ModTime()))) {
		t.offset, t.last, t.skipping = -1, Usage{}, false
	}
	t.info = info
	if t.offset < 0 {
		t.offset = max(0, info.Size()-initialTail)
		if t.offset > 0 {
			var b [1]byte
			_, err := f.ReadAt(b[:], t.offset-1)
			t.skipping = err != nil || b[0] != '\n'
		}
	}
	n := min(info.Size()-t.offset, maxRead)
	t.pending = false
	if n > 0 {
		buf := make([]byte, n)
		read, err := f.ReadAt(buf, t.offset)
		if err != nil && err != io.EOF {
			return t.last, t.last.Source != ""
		}
		buf = buf[:read]
		if t.skipping {
			if end := bytes.IndexByte(buf, '\n'); end >= 0 {
				t.offset += int64(end + 1)
				buf, t.skipping = buf[end+1:], false
			} else {
				t.offset += int64(len(buf))
				t.pending = t.offset < info.Size()
				return t.last, t.last.Source != ""
			}
		}
		if end := bytes.LastIndexByte(buf, '\n'); end >= 0 {
			switch source {
			case Claude:
				t.last = ScanClaude(bytes.NewReader(buf[:end+1]), t.last)
			case Codex:
				t.last = ScanCodex(bytes.NewReader(buf[:end+1]), t.last)
			}
			t.offset += int64(end + 1)
			if t.last.Source != "" && t.last.At.IsZero() {
				t.last.At = now
			}
		} else if len(buf) == maxRead {
			// Keep skipping until a newline; a JSON-looking suffix of an
			// oversized tool result must not become an independent event.
			t.offset += int64(len(buf))
			t.skipping = true
		}
		t.pending = n == maxRead && t.offset < info.Size()
	}
	return t.last, t.last.Source != ""
}

func (w *Watcher) Retain(ids []string) {
	keep := make(map[string]bool, len(ids))
	for _, id := range ids {
		keep[id] = true
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for id := range w.tail {
		if !keep[id] {
			delete(w.tail, id)
		}
	}
}
