package sysmon

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// startGroup runs a shell script in a process group of its own and ends the
// whole group when the test does.
//
// Killing the shell alone is what these tests used to do, and it leaked: in
// "sleep 30 & (while :; do :; done) & wait" the subshell is its own process,
// and with its parent gone it was handed to init and spun at a whole core for
// as long as the machine stayed up. Three of them were found burning three
// cores, two days after the runs that started them -- by the monitor this
// package feeds, once it could see processes that had left their tree.
func startGroup(t *testing.T, script string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sh", "-c", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_, _ = cmd.Process.Wait()
	})
	return cmd
}

// A process may be called anything. Chromium's renderers carry spaces; a
// program can be called "(foo) bar)" on purpose. Splitting the whole line on
// whitespace shifts every field after the name, and the numbers that come out
// are still numbers -- so this fails silently and reports a plausible ppid
// belonging to nobody.
func TestParseStatSurvivesAProcessNamedAnything(t *testing.T) {
	pageSize := uint64(os.Getpagesize())
	// pid comm state ppid pgrp session tty tpgid flags minflt cminflt majflt
	// cmajflt utime stime cutime cstime prio nice threads itrealvalue starttime
	// vsize rss
	tail := " S 4321 1 1 0 -1 0 0 0 0 0 70 30 0 0 20 0 3 0 900 12345 64" +
		" 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0"

	for _, comm := range []string{"(bash)", "(a b c)", "(weird) name)", "(())"} {
		st, ok := parseStat("1234 " + comm + tail)
		if !ok {
			t.Fatalf("%s: refused a well-formed line", comm)
		}
		if st.ppid != 4321 {
			t.Errorf("%s: ppid = %d, want 4321 -- the comm field shifted the parse", comm, st.ppid)
		}
		if st.ticks != 100 {
			t.Errorf("%s: ticks = %d, want 100 (utime 70 + stime 30)", comm, st.ticks)
		}
		if st.rss != 64*pageSize {
			t.Errorf("%s: rss = %d, want %d", comm, st.rss, 64*pageSize)
		}
		// The start time is half of what names a process for a kill, and the
		// name is shown to a person: both have to come out of the same line.
		if st.start != 900 {
			t.Errorf("%s: start = %d, want 900", comm, st.start)
		}
		if want := comm[1 : len(comm)-1]; st.comm != want {
			t.Errorf("%s: comm = %q, want %q", comm, st.comm, want)
		}
	}
}

func TestParseStatRefusesWhatItCannotRead(t *testing.T) {
	for _, line := range []string{"", "1234 (bash", "1234 (bash) S 1", "nonsense"} {
		if _, ok := parseStat(line); ok {
			t.Errorf("accepted %q", line)
		}
	}
}

// /proc is read without a lock, so a process can be reparented between reading
// its stat and reading its children's. The ppid graph assembled from two
// different instants can then contain a cycle that the kernel's real tree
// never had. Without the visited set this walk does not return.
func TestWalkTerminatesOnAReparentingRace(t *testing.T) {
	stats := map[int]procStat{
		10: {ppid: 11, ticks: 1},
		11: {ppid: 10, ticks: 2},
		12: {ppid: 10, ticks: 4},
	}
	children := map[int][]int{10: {11, 12}, 11: {10}}

	done := make(chan uint64, 1)
	go func() {
		var total uint64
		walkInto(10, stats, children, map[int]bool{}, func(pid int) { total += stats[pid].ticks })
		done <- total
	}()

	select {
	case total := <-done:
		if total != 7 {
			t.Errorf("ticks = %d, want 7 -- each process counted exactly once", total)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("walk did not terminate on a cycle in the ppid graph")
	}
}

// The number that matters is the tree's, not the pane process's own: the pane
// runs a shell, the shell runs the agent, and the agent is where the CPU goes.
func TestSampleCountsTheWholeTreeUnderThePane(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}

	// A shell that does nothing but hold a child, which is the shape of a real
	// pane: sh -> agent.
	parent := startGroup(t, "sleep 30 & wait")
	// Give the shell time to fork.
	deadline := time.Now().Add(5 * time.Second)
	var ts TreeSampler
	var got Usage
	for time.Now().Before(deadline) {
		u := ts.Sample(map[string]int{"s1": parent.Process.Pid})
		if u["s1"].Procs >= 2 {
			got = u["s1"]
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if got.Procs < 2 {
		t.Fatalf("procs = %d, want at least 2 (the shell and its child)", got.Procs)
	}
	if got.RSS == 0 {
		t.Error("rss = 0 for two live processes")
	}
}

// Zero is a real reading and "the session is gone" is not. Reporting a dead
// pane as 0% and 0 bytes puts a row on screen that looks like an idle session.
func TestSampleOmitsAPidThatIsGone(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}
	cmd := exec.Command("true")
	if err := cmd.Run(); err != nil {
		t.Fatalf("run: %v", err)
	}
	dead := cmd.Process.Pid

	var ts TreeSampler
	got := ts.Sample(map[string]int{"alive": os.Getpid(), "dead": dead})
	if _, ok := got["dead"]; ok {
		t.Errorf("reported pid %d, which has exited", dead)
	}
	if _, ok := got["alive"]; !ok {
		t.Error("dropped the live session as well")
	}
}

// The first sample has nothing to difference against, and busy work between
// two samples has to show up as more than zero.
func TestCPUPercentNeedsTwoSamples(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}
	spin := startGroup(t, "while :; do :; done")
	pane := map[string]int{"s1": spin.Process.Pid}

	var ts TreeSampler
	if first := ts.Sample(pane)["s1"]; first.CPUPercent != 0 {
		t.Errorf("first sample reported %.2f%%, with nothing to compare against", first.CPUPercent)
	}
	// Long enough to be past minCPUWindow and to accumulate ticks: USER_HZ is
	// 100, so a shorter window can round a busy process down to nothing.
	time.Sleep(1200 * time.Millisecond)
	second := ts.Sample(pane)["s1"]
	if second.CPUPercent <= 0 {
		t.Errorf("a spinning process measured %.2f%%", second.CPUPercent)
	}
	if second.CPUPercent > 100 {
		t.Errorf("%.2f%% of the machine", second.CPUPercent)
	}
}

// The question CPUPercent alone cannot answer: a shell holding one busy child
// and a dozen idle ones reads the same aggregate as a shell running one
// moderately busy thing -- Top is what tells them apart.
func TestTopNamesTheBusiestProcessInTheTree(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}
	// A quiet parent holding one spinning child and one merely sleeping one,
	// the shape of a pane where the aggregate is right but naming "the shell"
	// as the culprit would be useless.
	parent := startGroup(t, "sleep 30 & (while :; do :; done) & wait")
	pane := map[string]int{"s1": parent.Process.Pid}

	var ts TreeSampler
	// Give the shell time to fork both children before the first sample, so
	// the window below measures both of them rather than starting mid-fork.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ts.Sample(pane)["s1"].Procs >= 3 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	time.Sleep(1200 * time.Millisecond)
	got := ts.Sample(pane)["s1"]
	if len(got.Top) == 0 {
		t.Fatal("Top is empty with three live processes to name")
	}
	if got.Top[0].CPUPercent <= 0 {
		t.Errorf("busiest entry read %.2f%%, want the spinning child's share", got.Top[0].CPUPercent)
	}
	for i := 1; i < len(got.Top); i++ {
		if got.Top[i].CPUPercent > got.Top[i-1].CPUPercent {
			t.Errorf("Top is not sorted: entry %d (%.2f%%) beats entry %d (%.2f%%)",
				i, got.Top[i].CPUPercent, i-1, got.Top[i-1].CPUPercent)
		}
	}
}

// Two viewers landing a few milliseconds apart must not consume each other's
// measuring window -- a percentage over five milliseconds reads 0 or 100
// depending on where the sample fell.
func TestASecondCallerTooSoonGetsTheSameAnswer(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}
	pane := map[string]int{"self": os.Getpid()}
	var ts TreeSampler
	ts.Sample(pane)
	time.Sleep(600 * time.Millisecond)
	a := ts.Sample(pane)["self"]
	b := ts.Sample(pane)["self"]
	if a.CPUPercent != b.CPUPercent {
		t.Errorf("%.4f then %.4f within the window", a.CPUPercent, b.CPUPercent)
	}
}

func TestReadProcTableSeesThisProcess(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}
	table := readProcTable()
	if _, ok := table[os.Getpid()]; !ok {
		t.Fatalf("pid %s missing from a table of %d", strconv.Itoa(os.Getpid()), len(table))
	}
}

// A process that has left its pane's tree -- `cmd &` from a shell that then
// exited, nohup, a dev server an agent started and moved on from -- is still
// the session's. It is found by the session id its environment inherited, and
// counted, and said to be detached.
func TestADetachedProcessIsStillItsSessions(t *testing.T) {
	if _, err := os.Stat("/proc/self/environ"); err != nil {
		t.Skip("no /proc here")
	}
	pane := startGroup(t, "sleep 60")
	other := startGroup(t, "sleep 60")
	// The outer shell starts the spinner in the background and exits, so the
	// spinner is reparented away from anything a pane walk would reach.
	launcher := exec.Command("sh", "-c", "VIBEPANEL_SESSION_ID=s1 sh -c 'while :; do :; done' >/dev/null 2>&1 &")
	launcher.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := launcher.Run(); err != nil {
		t.Fatalf("launch: %v", err)
	}
	t.Cleanup(func() { _ = syscall.Kill(-launcher.Process.Pid, syscall.SIGKILL) })

	paneOf := map[string]int{"s1": pane.Process.Pid, "s2": other.Process.Pid}
	var ts TreeSampler
	ts.Sample(paneOf)
	time.Sleep(1200 * time.Millisecond)
	got := ts.Sample(paneOf)

	var found *ProcUsage
	for i, p := range got["s1"].Top {
		if p.Detached {
			found = &got["s1"].Top[i]
		}
	}
	if found == nil {
		t.Fatalf("s1's reading has no detached process: %+v", got["s1"])
	}
	// Named by what it runs, not by the kernel's "sh".
	if !strings.Contains(found.Cmd, "while :") {
		t.Errorf("the detached spinner's command line reads %q", found.Cmd)
	}
	if found.CPUPercent <= 0 || got["s1"].CPUPercent < found.CPUPercent {
		t.Errorf("the detached spinner reads %.2f%% and the session %.2f%%; it is the session's",
			found.CPUPercent, got["s1"].CPUPercent)
	}
	// The two panes are the same script, so whatever a shell does about
	// exec'ing its last command, s1 is exactly one process more than s2.
	if got["s1"].Procs != got["s2"].Procs+1 {
		t.Errorf("s1 counts %d processes and s2 %d; s1 should have the spinner on top of the same pane",
			got["s1"].Procs, got["s2"].Procs)
	}

	// A session id nothing is running under claims nothing: this is how a
	// test harness's own panel, or a deleted session, stays out.
	delete(paneOf, "s1")
	time.Sleep(600 * time.Millisecond)
	for id, u := range ts.Sample(paneOf) {
		for _, p := range u.Top {
			if p.Detached {
				t.Errorf("%s claimed pid %d for a session that is not running", id, p.PID)
			}
		}
	}
}

// A process that joins a reading between two samples is counted for what it
// did in the window, not for its whole life. The tree-total difference this
// replaced counted a long-running detached process's lifetime the first time
// it was found, and read any window in which a process exited as zero.
func TestTheSessionShareIsTheSumOfItsProcessesInTheWindow(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}
	pane := startGroup(t, "while :; do :; done")
	paneOf := map[string]int{"s1": pane.Process.Pid}
	var ts TreeSampler
	ts.Sample(paneOf)
	time.Sleep(1200 * time.Millisecond)
	u := ts.Sample(paneOf)["s1"]
	var sum float64
	for _, p := range u.Top {
		sum += p.CPUPercent
	}
	if u.CPUPercent <= 0 || u.CPUPercent-sum > 0.01 || sum-u.CPUPercent > 0.01 {
		t.Errorf("session %.3f%%, its processes %.3f%%", u.CPUPercent, sum)
	}
}

// A process born between two samples is counted for everything it did, since
// all of it happened inside the window. Per-process diffs alone would read it
// as zero -- there is nothing earlier to diff against -- and a build is mostly
// compilers that live for a second or two.
func TestAProcessBornInsideTheWindowCounts(t *testing.T) {
	if _, err := os.Stat("/proc/self/stat"); err != nil {
		t.Skip("no /proc here")
	}
	pane := startGroup(t, "sleep 0.2; sh -c 'while :; do :; done'")
	paneOf := map[string]int{"s1": pane.Process.Pid}
	var ts TreeSampler
	ts.Sample(paneOf) // before the spinner exists
	time.Sleep(1200 * time.Millisecond)
	if u := ts.Sample(paneOf)["s1"]; u.CPUPercent <= 0 {
		t.Errorf("a spinner born after the first sample reads %.3f%% for the session", u.CPUPercent)
	}
}
