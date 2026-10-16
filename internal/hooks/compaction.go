package hooks

import "encoding/json"

const SignalPreCompact = "precompact"

// CompactionImminent accepts only the Claude event and its two known triggers.
// Missing or unfamiliar fields do nothing; a future document shape cannot
// accidentally authorise a handoff. Extra fields are deliberately ignored.
func CompactionImminent(body []byte) bool {
	if len(body) > MaxPayload {
		return false
	}
	var doc struct {
		Event   string `json:"hook_event_name"`
		Trigger string `json:"trigger"`
	}
	return json.Unmarshal(body, &doc) == nil && doc.Event == "PreCompact" &&
		(doc.Trigger == "auto" || doc.Trigger == "manual")
}

// BackgroundWork reads an explicit main-thread inventory, when supplied.
// The display intentionally ignores background shells; automatic rollover
// cannot: a known long command must finish before its session is ended.
func BackgroundWork(body []byte) (running, known bool) {
	if len(body) > MaxPayload {
		return false, false
	}
	var doc struct {
		Event string `json:"hook_event_name"`
		Agent string `json:"agent_id"`
		Tasks *[]struct {
			Status string `json:"status"`
		} `json:"background_tasks"`
	}
	if json.Unmarshal(body, &doc) != nil || doc.Agent != "" || doc.Event != "Stop" || doc.Tasks == nil {
		return false, false
	}
	for _, task := range *doc.Tasks {
		if task.Status == "running" || task.Status == "pending" {
			return true, true
		}
	}
	return false, true
}
