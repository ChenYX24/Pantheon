package httpapi

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/parthenon"
)

func TestHomeModelsConfiguredAndDefault(t *testing.T) {
	s := newInProcessTestServer(t)
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("ANTHROPIC_MODEL", "")
	t.Setenv("PATH", dir)
	homePut(t, filepath.Join(dir, "claude"), "#!/bin/sh\nexit 1\n")
	if err := os.Chmod(filepath.Join(dir, "claude"), 0755); err != nil {
		t.Fatal(err)
	}
	homePut(t, filepath.Join(dir, ".claude/settings.json"), `{}`)
	homePut(t, filepath.Join(dir, ".codex/config.toml"), "model = \"custom-model\"\n[tui.model_availability_nux]\n\"gpt-6-astra\" = true\n\"another-model\" = false\n")
	got := homeDecode[struct {
		Harnesses []parthenon.HarnessModels `json:"harnesses"`
	}](t, homeRequest(t, s, "GET", "/api/home/models", "", true), 200)
	if len(got.Harnesses) != 2 || got.Harnesses[0].Default != "claude-opus-5-5" || !got.Harnesses[0].Installed || got.Harnesses[1].Installed {
		t.Fatal(got)
	}
	if !reflect.DeepEqual(got.Harnesses[1].Models, []string{"custom-model", "gpt-6-astra", "gpt-6.1-sol", "another-model"}) {
		t.Fatal(got.Harnesses[1])
	}
	if parthenon.Executors()[0].Model != "" {
		t.Fatal("workflow executor API changed")
	}
}
