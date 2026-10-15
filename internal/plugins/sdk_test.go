package plugins

import (
	"encoding/json"
	"testing"

	"github.com/dop251/goja"
)

func TestSDKRequestsStayUnderTheFrameMount(t *testing.T) {
	for _, mount := range []string{"", "/dev", "/dev/panel"} {
		t.Run(mount, func(t *testing.T) {
			vm := goja.New()
			pathname, _ := json.Marshal(mount + "/plugin/abcdefghijklmnopqrstuvwx/pane.html")
			_, err := vm.RunString(`
var location = {origin: 'https://panel.test', pathname: ` + string(pathname) + `};
var parent = globalThis;
var urls = [];
function addEventListener() {}
function setTimeout() { return 1; }
function clearTimeout() {}
function fetch(url) { urls.push(url); return new Promise(function () {}); }
function EventSource(url) { urls.push(url); this.addEventListener = function () {}; }
`)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := vm.RunString(string(SDK)); err != nil {
				t.Fatal(err)
			}
			if _, err := vm.RunString(`VibePanel.plugin()`); err != nil {
				t.Fatal(err)
			}
			var urls []string
			if err := vm.ExportTo(vm.Get("urls"), &urls); err != nil {
				t.Fatal(err)
			}
			base := "https://panel.test" + mount + "/api/plugin/abcdefghijklmnopqrstuvwx/v1/"
			if len(urls) != 2 || urls[0] != base+"events" || urls[1] != base+"view" {
				t.Fatalf("SDK requests = %v", urls)
			}
		})
	}
}
