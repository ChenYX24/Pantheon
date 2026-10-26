package hooks

import (
	"errors"
	"fmt"
	"os"
)

// The status line is the one place Claude Code reports a subscription's
// limits: rate_limits.five_hour and seven_day, in the document it pipes to the
// command named by statusLine in settings.json. Its hooks do not carry them and
// its transcripts do not either. So the panel offers to name its reporter
// there, with `quota`, which prints nothing: the status line stays as empty as
// it was, and the input box above it keeps the shape the rollover reads
// (rollover.AtInputBox; measured with a real Max login on 2.1.310).
//
// There is one statusLine and it may be somebody's own, so this is stricter
// than the hooks, where entries sit side by side: install refuses to replace a
// status line that is not the panel's, and removal takes it out only when it
// is.

// StatusLine says whose status line settings.json names: "" for none,
// "ours" for this panel's reporter, "other" for anything else.
const (
	StatusLineNone  = ""
	StatusLineOurs  = "ours"
	StatusLineOther = "other"
)

// ErrStatusLineTaken is the refusal to replace somebody's own status line.
var ErrStatusLineTaken = errors.New("hooks: ~/.claude/settings.json already has a status line of its own; remove it there first")

func statusLineCommand(scriptPath string) string {
	return command(scriptPath, SignalQuota)
}

func statusLineOwner(doc map[string]any) string {
	v, ok := doc["statusLine"]
	if !ok || v == nil {
		return StatusLineNone
	}
	sl, _ := v.(map[string]any)
	cmd, _ := sl["command"].(string)
	// The marker rather than this exact path, as isOurs does: a panel moved
	// to another data directory still owns the line an earlier one wrote,
	// and removing it is what somebody pressing remove means.
	if sl != nil && containsMarker(cmd) {
		return StatusLineOurs
	}
	return StatusLineOther
}

// statusLineCurrent is whether the line in doc is this script's exactly.
func statusLineCurrent(doc map[string]any, scriptPath string) bool {
	sl, _ := doc["statusLine"].(map[string]any)
	cmd, _ := sl["command"].(string)
	return sl != nil && sl["type"] == "command" && cmd == statusLineCommand(scriptPath)
}

// InstallClaudeQuota names the reporter as Claude Code's status line.
func InstallClaudeQuota(scriptPath string) (Status, error) {
	editMu.Lock()
	defer editMu.Unlock()
	settingsPath, err := ClaudeSettingsPath()
	if err != nil {
		return Status{}, err
	}
	doc, err := readSettings(settingsPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Status{}, err
	}
	if doc == nil {
		doc = map[string]any{}
	}
	if statusLineOwner(doc) == StatusLineOther {
		return Status{}, ErrStatusLineTaken
	}
	before := encode(doc)
	doc["statusLine"] = map[string]any{"type": "command", "command": statusLineCommand(scriptPath), "padding": 0}
	if unchanged(before, doc) {
		return Inspect(scriptPath)
	}
	if err := backup(settingsPath); err != nil {
		return Status{}, err
	}
	if err := writeSettings(settingsPath, doc); err != nil {
		return Status{}, err
	}
	return Inspect(scriptPath)
}

// UninstallClaudeQuota removes the status line only when it is the panel's.
func UninstallClaudeQuota(scriptPath string) (Status, error) {
	editMu.Lock()
	defer editMu.Unlock()
	settingsPath, err := ClaudeSettingsPath()
	if err != nil {
		return Status{}, err
	}
	doc, err := readSettings(settingsPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Inspect(scriptPath)
		}
		return Status{}, err
	}
	if statusLineOwner(doc) != StatusLineOurs {
		return Inspect(scriptPath)
	}
	delete(doc, "statusLine")
	if err := backup(settingsPath); err != nil {
		return Status{}, err
	}
	if err := writeSettings(settingsPath, doc); err != nil {
		return Status{}, fmt.Errorf("hooks: remove status line: %w", err)
	}
	return Inspect(scriptPath)
}

// ClaudeQuotaSnippet is what install merges, for the page to show first.
func ClaudeQuotaSnippet(scriptPath string) string {
	return string(encode(map[string]any{"statusLine": map[string]any{
		"type": "command", "command": statusLineCommand(scriptPath), "padding": 0,
	}}))
}
