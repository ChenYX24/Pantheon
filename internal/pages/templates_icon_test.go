package pages

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A share page with no icon of its own makes the browser ask for /favicon.ico
// at the panel's root, and the page's own CSP refuses it: Firefox logged a
// Content-Security-Policy error on every load of every wall. An explicit
// empty icon is a `data:` image, which img-src already allows, and the
// request never happens. Every built-in template, and every page in one.
func TestEveryTemplatePageDeclaresItsIcon(t *testing.T) {
	err := filepath.WalkDir("templates", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".html") {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if !strings.Contains(string(b), `rel="icon"`) {
			t.Errorf("%s has no icon, so the browser asks for /favicon.ico and the CSP refuses it", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
