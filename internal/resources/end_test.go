package resources

import (
	"context"
	"errors"
	"os"
	"syscall"
	"testing"
	"time"
)

func TestRolloverProcessEndingOrderAndRevalidation(t *testing.T) {
	for _, stale := range []bool{false, true} {
		checks := 0
		signals := []syscall.Signal{}
		waits := 0
		err := endGroups(context.Background(), func() ([]int, error) {
			checks++
			if stale && checks == 2 {
				return nil, ErrNotInSession
			}
			return []int{123}, nil
		}, func(pid int, sig syscall.Signal) error {
			if pid != -123 {
				t.Fatal(pid)
			}
			signals = append(signals, sig)
			return nil
		}, func(_ context.Context, d time.Duration) error {
			if d != 10*time.Second || len(signals) != 1 || signals[0] != syscall.SIGTERM {
				t.Fatal(d, signals)
			}
			waits++
			return nil
		})
		if waits != 1 {
			t.Fatal(waits)
		}
		if stale {
			if !errors.Is(err, ErrNotInSession) || len(signals) != 1 {
				t.Fatal(err, signals)
			}
		} else if err != nil || len(signals) != 2 || signals[1] != syscall.SIGKILL {
			t.Fatal(err, signals)
		}
	}
}

func TestRolloverEndOnlySignalsItsDisposablePane(t *testing.T) {
	w, _, pane, child := oneSession(t)
	_, other := spawnPane(t)
	env := w.env()
	// The test runner stands in for the protected server, never a real tmux.
	env.ServerPID = func(context.Context) (int, error) { return os.Getpid(), nil }
	g := New(env)
	end, err := g.PrepareRolloverEnd(context.Background(), "a")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := end(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	waitGone(t, pane)
	waitGone(t, child)
	if !alive(other) {
		t.Fatal("another pane was signalled")
	}
	w.panes[0].PID = os.Getpid()
	if _, err := g.PrepareRolloverEnd(context.Background(), "a"); err == nil {
		t.Fatal("panel process accepted as an end target")
	}
}

func TestRolloverEndRefusesAReplacementPane(t *testing.T) {
	w, _, _, child := oneSession(t)
	replacement, other := spawnPane(t)
	env := w.env()
	env.ServerPID = func(context.Context) (int, error) { return os.Getpid(), nil }
	g := New(env)
	end, err := g.PrepareRolloverEnd(context.Background(), "a")
	if err != nil {
		t.Fatal(err)
	}
	w.panes[0].PID = replacement
	if err := end(context.Background()); !errors.Is(err, ErrGone) {
		t.Fatal(err)
	}
	if !alive(child) || !alive(other) {
		t.Fatal("a replaced pane must be refused without signalling either process")
	}
}
