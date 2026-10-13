package httpapi

import (
	"context"
	"fmt"
	"runtime/metrics"
	"time"

	"github.com/dop251/goja"
)

// What keeps one server.js from taking the panel's memory with it.
//
// The budget is an interrupt, and an interrupt is checked between
// instructions -- not inside a native call. `new Array(2**28).fill(0)` is one
// native call: measured here at 8.3 GiB and 36 seconds, with the budget long
// expired and nothing able to stop it. `'x'.padStart(2**28)` is 256 MiB in
// one call. A server.js is a plugin's or a page owner's code, so this is the
// panel's process on the line (the sessions are not: they are tmux's).
//
// Three layers, none sufficient alone:
//
//   - jsPrelude wraps the natives that allocate by a number the script
//     chooses, so the number is checked before the allocation;
//   - jsSlots caps how many runtimes exist at once across every page and
//     plugin, so whatever one call can hold is multiplied by a small number;
//   - jsHeapWatch interrupts a call while the heap grows past jsHeapGrowth,
//     which is what catches the loop `s += s` -- interruptible, but fast
//     enough to reach hundreds of megabytes inside a 500 ms budget.
//
// What is left: a native that iterates a length set some other way (an
// array's length assigned directly and then joined, say). The watch bounds
// those to the extent the heap shows it between instructions.

const (
	// jsMaxLength is the longest string or array the wrapped natives make:
	// four million, which is far past anything a wall or a plugin route
	// returns (results are capped at pages.MaxServerResult anyway).
	jsMaxLength = 1 << 22
	// jsParallel is how many server.js calls run at once, panel-wide.
	jsParallel = 8
	// jsHeapGrowth is how far the heap may grow during one call before it is
	// interrupted, and jsHeapEvery how often that is looked at.
	jsHeapGrowth = 256 << 20
	jsHeapEvery  = 5 * time.Millisecond
)

var jsSlots = make(chan struct{}, jsParallel)

// jsAcquire takes a slot, waiting at most the call's budget for one.
func jsAcquire(ctx context.Context, c jsCall) (release func(), err error) {
	t := time.NewTimer(c.budget)
	defer t.Stop()
	select {
	case jsSlots <- struct{}{}:
		return func() { <-jsSlots }, nil
	case <-t.C:
		return nil, dataErrorf("server.js %s waited %v for a turn; the panel is running %d already", c.what, c.budget, jsParallel)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

var jsPrelude = goja.MustCompile("prelude.js", fmt.Sprintf(`(function () {
  var MAX = %d;
  // Reflect.apply rather than f.apply: Function.prototype.apply is one of
  // the things wrapped below, and the wrapper calling it would be itself.
  var call = Reflect.apply;
  function tooBig(what, n) { throw new RangeError(what + ' of ' + n + ' is over the panel\'s limit of ' + MAX); }
  function wrap(obj, name, check) {
    var orig = obj[name];
    Object.defineProperty(obj, name, { configurable: true, writable: true, enumerable: false,
      value: function () { call(check, this, arguments); return call(orig, this, arguments); } });
  }
  wrap(String.prototype, 'repeat', function (n) { if (String(this).length * Number(n) > MAX) tooBig('repeat', String(this).length * Number(n)); });
  wrap(String.prototype, 'padStart', function (n) { if (Number(n) > MAX) tooBig('padStart', n); });
  wrap(String.prototype, 'padEnd', function (n) { if (Number(n) > MAX) tooBig('padEnd', n); });
  // Array(n) alone allocates nothing: it is a length on an empty object.
  // What allocates, or loops natively, is a method that walks that length,
  // so those are where the length is checked. The iterators are on the list
  // because spread and for-of go through them: [...Array(2**26)] was 2 GiB.
  ['fill', 'join', 'map', 'filter', 'slice', 'splice', 'concat', 'reverse', 'sort', 'flat', 'flatMap',
   'copyWithin', 'forEach', 'reduce', 'reduceRight', 'some', 'every', 'indexOf', 'lastIndexOf', 'includes',
   'find', 'findIndex', 'findLast', 'findLastIndex', 'toString', 'toLocaleString', 'values', 'keys', 'entries'
  ].forEach(function (name) {
    if (typeof Array.prototype[name] === 'function') {
      wrap(Array.prototype, name, function () { if (this != null && this.length > MAX) tooBig(name + ' over a length', this.length); });
    }
  });
  Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, writable: true, enumerable: false,
    value: Array.prototype.values });
  wrap(Array, 'from', function (src) { if (src != null && Number(src.length) > MAX) tooBig('Array.from of a length', src.length); });
  wrap(Function.prototype, 'apply', function (self, args) { if (args != null && Number(args.length) > MAX) tooBig('apply with arguments of a length', args.length); });
})();`, jsMaxLength), false)

// jsHeapWatch interrupts vm while the heap grows past jsHeapGrowth since the
// call began. The heap is the process's, so another goroutine's allocation
// counts as well; the threshold is set high enough that a call has to be the
// cause in practice. Returns the function that stops watching.
func jsHeapWatch(vm *goja.Runtime, what string) func() {
	sample := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
	heap := func() uint64 {
		metrics.Read(sample)
		if sample[0].Value.Kind() != metrics.KindUint64 {
			return 0
		}
		return sample[0].Value.Uint64()
	}
	base := heap()
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(jsHeapEvery)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				if h := heap(); h > base && h-base > jsHeapGrowth {
					vm.Interrupt(fmt.Sprintf("%s used more than %d MiB", what, jsHeapGrowth>>20))
					return
				}
			}
		}
	}()
	return func() { close(done) }
}
