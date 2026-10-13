package httpapi

import "sync"

// streamStop ends the requests that would otherwise hold a shutdown open.
//
// http.Server.Shutdown waits for every request that has not been hijacked,
// and it does not cancel their contexts. A plugin frame's event stream and a
// plugin process's streamed answer return only when their request context
// ends, so one open frame made Shutdown run its whole budget -- and the steps
// after it shared that budget: StopPluginProcesses returned without waiting
// out the grace, leaving process groups behind, and ArchiveAll's last capture
// of every pane, which is what makes an orderly restart lossless, failed on a
// dead context. WebSockets are hijacked and not affected.
type streamStop struct {
	mu     sync.Mutex
	ch     chan struct{}
	closed bool
}

// streamsEnded is closed by EndStreams. Made on first use because a Server is
// a struct literal and has no constructor to make it in.
func (s *Server) streamsEnded() <-chan struct{} {
	s.streams.mu.Lock()
	defer s.streams.mu.Unlock()
	if s.streams.ch == nil {
		s.streams.ch = make(chan struct{})
	}
	return s.streams.ch
}

// EndStreams ends every open event stream and streamed plugin answer. Call it
// before, or register it with, http.Server.Shutdown. Safe to call twice.
func (s *Server) EndStreams() {
	s.streams.mu.Lock()
	defer s.streams.mu.Unlock()
	if s.streams.ch == nil {
		s.streams.ch = make(chan struct{})
	}
	if !s.streams.closed {
		close(s.streams.ch)
		s.streams.closed = true
	}
}
