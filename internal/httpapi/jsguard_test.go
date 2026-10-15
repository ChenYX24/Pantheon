package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
)

func runGuarded(t *testing.T, body string) (any, error, time.Duration) {
	t.Helper()
	prog, err := goja.Compile("server.js", "function f() { "+body+" }", false)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	out, err := runJS(context.Background(), prog, jsCall{hook: "f", what: "probe", budget: 2 * time.Second,
		log: func(string, string) {}})
	return out, err, time.Since(start)
}

// Each of these allocated by a number the script chose, inside one native
// call the budget could not interrupt: Array(2**28).fill(0) was 8.3 GiB and
// thirty-six seconds. Each must now fail fast, and well inside the budget.
func TestAServerJSCannotAllocateItsWayPastTheBudget(t *testing.T) {
	for _, body := range []string{
		`return 'x'.repeat(Math.pow(2, 30)).length`,
		`return 'x'.padStart(Math.pow(2, 28)).length`,
		`return 'x'.padEnd(Math.pow(2, 28)).length`,
		`return new Array(Math.pow(2, 28)).fill(0).length`,
		`var a = []; a.length = Math.pow(2, 28); return a.fill(0).length`,
		`var a = []; a.length = Math.pow(2, 28); return a.join(',').length`,
		`return Array.from({length: Math.pow(2, 28)}).length`,
		`var s = 'x'; while (s.length < Math.pow(2, 30)) s += s; return s.length`,
		`return [...Array(Math.pow(2, 26))].length`,
		`var a = []; a[Math.pow(2, 26)] = 1; return a.map(function (x) { return x }).length`,
		`return Array(Math.pow(2, 26)).concat([1]).length`,
		`return Array.prototype.slice.call({length: Math.pow(2, 26)}).length`,
		`return Array.apply(null, {length: Math.pow(2, 24)}).length`,
		`return String(Array(Math.pow(2, 24))).length`,
		`var n = 0; for (var x of Array(Math.pow(2, 26))) n++; return n`,
	} {
		_, err, took := runGuarded(t, body)
		if err == nil {
			t.Errorf("%s: ran to completion", body)
		}
		if took > time.Second {
			t.Errorf("%s: took %v before it was stopped", body, took)
		}
	}
}

// The wrapping is invisible to code that stays inside the limits.
func TestTheGuardsLeaveOrdinaryCodeAlone(t *testing.T) {
	out, err, _ := runGuarded(t, `
	  var a = new Array(3).fill(1), b = Array(2), c = Array.from('ab'), d = Array.of(7);
	  return [ 'ab'.repeat(2), '7'.padStart(3, '0'), 'x'.padEnd(2, '.'), a.join(''), b.length,
	           c.join(''), d[0], Array.isArray(a), [] instanceof Array, a instanceof Array,
	           [...a].length, Math.max.apply(null, [1, 5, 2]), a.map(function (x) { return x + 1 }).join(''),
	           Array.prototype.slice.call({length: 2, 0: 'p', 1: 'q'}).join('') ].join('|')`)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := out, "abab|007|x.|111|2|ab|7|true|true|true|3|5|222|pq"; got != want {
		t.Errorf("got %v, want %v", got, want)
	}
}

// Calls past jsParallel wait for a turn, and give up after their budget
// with words rather than piling up runtimes.
func TestServerJSCallsAreCappedPanelWide(t *testing.T) {
	for i := 0; i < jsParallel; i++ {
		jsSlots <- struct{}{}
	}
	defer func() {
		for i := 0; i < jsParallel; i++ {
			<-jsSlots
		}
	}()
	prog, _ := goja.Compile("server.js", "function f() { return 1 }", false)
	_, err := runJS(context.Background(), prog, jsCall{hook: "f", what: "probe", budget: 50 * time.Millisecond,
		log: func(string, string) {}})
	if err == nil || !strings.Contains(err.Error(), "waited") {
		t.Errorf("a call with every slot taken: %v", err)
	}
}
