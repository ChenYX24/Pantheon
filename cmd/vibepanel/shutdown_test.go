package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// fakeStopper stands in for the panel: a stream that ends only on
// EndStreams, as a plugin frame's does, and the two steps after Shutdown
// recording whether their context was still alive when they ran.
type fakeStopper struct {
	once    sync.Once
	ended   chan struct{}
	procErr error
	archErr error
}

func (f *fakeStopper) EndStreams() { f.once.Do(func() { close(f.ended) }) }
func (f *fakeStopper) StopPluginProcesses(ctx context.Context) {
	f.procErr = ctx.Err()
}
func (f *fakeStopper) ArchiveAll(ctx context.Context) { f.archErr = ctx.Err() }

// With a stream open, serve stops promptly, and the plugin processes and the
// last capture each run on a live context. They shared one context with
// Shutdown, which an open stream held for its whole budget.
func TestStoppingWithAStreamOpenLeavesTheLaterStepsTheirBudget(t *testing.T) {
	f := &fakeStopper{ended: make(chan struct{})}
	opened := make(chan struct{})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(opened)
		select {
		case <-r.Context().Done():
		case <-f.ended:
		}
	}))
	defer ts.Close()
	// Runs before ts.Close: with the fix taken out nothing else ends the
	// stream, and Close would wait for it for ever instead of failing.
	defer f.EndStreams()
	go func() {
		// Read until the server ends it, as a frame does; closing early
		// would end the request from this side and prove nothing.
		res, err := http.Get(ts.URL)
		if err == nil {
			_, _ = io.Copy(io.Discard, res.Body)
			res.Body.Close()
		}
	}()
	<-opened

	start := time.Now()
	stopServing(ts.Config, f, 2*time.Second)
	if took := time.Since(start); took > time.Second {
		t.Errorf("stopping with a stream open took %v", took)
	}
	if f.procErr != nil {
		t.Errorf("StopPluginProcesses ran on a dead context: %v", f.procErr)
	}
	if f.archErr != nil {
		t.Errorf("ArchiveAll ran on a dead context: %v", f.archErr)
	}
}
