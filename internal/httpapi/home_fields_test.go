package httpapi

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
)

func TestHomeFieldsMetaTasksAndReportReplyAPI(t *testing.T) {
	s := newInProcessTestServer(t)
	project := homeFixture(t, s)
	s.Cfg.Development = true
	fields := homeDecode[struct {
		Fields home.Fields `json:"fields"`
		Rev    string      `json:"rev"`
	}](t, homeRequest(t, s, "GET", "/api/home/fields", "", true), 200)
	raw, _ := json.Marshal(fields)
	saved := homeDecode[struct {
		Fields home.Fields `json:"fields"`
		Rev    string      `json:"rev"`
	}](t, homeRequest(t, s, "PUT", "/api/home/fields", string(raw), true), 200)
	if saved.Rev == "" {
		t.Fatal("missing rev")
	}
	homeDecode[map[string]any](t, homeRequest(t, s, "PUT", "/api/home/fields", string(raw), true), 409)
	homeDecode[map[string]any](t, homeRequest(t, s, "PUT", "/api/home/fields", `{"fields":{}}`, true), 400)
	meta := homeDecode[struct {
		Meta home.ProjectMeta `json:"meta"`
		Rev  string           `json:"metaRev"`
	}](t, homeRequest(t, s, "PATCH", "/api/home/projects/demo/meta", `{"rev":"","labels":["产品"],"priority":"P1","pinned":true}`, true), 200)
	if !meta.Meta.Pinned || meta.Rev == "" {
		t.Fatal(meta)
	}
	homeDecode[map[string]any](t, homeRequest(t, s, "PATCH", "/api/home/projects/demo/meta", `{"rev":"","owner":"cyx"}`, true), 409)
	task := homeDecode[home.Task](t, homeRequest(t, s, "POST", "/api/home/projects/demo/tasks", `{"id":"A2","title":"API"}`, true), 201)
	task = homeDecode[home.Task](t, homeRequest(t, s, "PATCH", "/api/home/projects/demo/tasks/A2", `{"rev":"`+task.Rev+`","priority":"P0","tags":["后端"],"owner":"codex","due":"2026-10-12"}`, true), 200)
	if task.Owner != "codex" || task.Due != "2026-10-12" || len(task.Tags) != 1 {
		t.Fatal(task)
	}
	homePut(t, filepath.Join(filepath.Dir(project), "archived/project.json"), `{"id":"archived","status":"archived"}`)
	homePut(t, filepath.Join(filepath.Dir(project), "archived/agent-docs/tasks/X/task.md"), "---\nid: X\nstatus: done\n---\n")
	for _, test := range []struct {
		Query string
		Count int
	}{{"", 1}, {"?all=1", 2}} {
		rows := homeDecode[struct {
			Tasks []struct {
				home.Task
				ProjectID string `json:"projectId"`
			} `json:"tasks"`
			Fields home.Fields `json:"fields"`
		}](t, homeRequest(t, s, "GET", "/api/home/tasks"+test.Query, "", true), 200)
		if len(rows.Tasks) != test.Count || rows.Tasks[0].ProjectID != "demo" || rows.Fields.Task["status"].Options == nil {
			t.Fatal(rows)
		}
	}
	homePut(t, filepath.Join(project, "agent-docs/reports/q.md"), "---\ntitle: Approval\nkind: question\nneeds_user: true\n---\nQuestion\n")
	before := homeDecode[home.Detail](t, homeRequest(t, s, "GET", "/api/home/projects/demo", "", true), 200)
	if len(before.Todos) != 1 {
		t.Fatal("missing question")
	}
	homeDecode[map[string]any](t, homeRequest(t, s, "POST", "/api/home/projects/demo/reports/q.md/reply", `{"text":"yes","rev":"stale"}`, true), 409)
	report := homeDecode[home.Report](t, homeRequest(t, s, "POST", "/api/home/projects/demo/reports/q.md/reply", `{"text":"Approved","rev":"`+before.Reports[0].Rev+`"}`, true), 200)
	if report.NeedsUser || len(report.Replies) != 1 {
		t.Fatal(report)
	}
	after := homeDecode[home.Detail](t, homeRequest(t, s, "GET", "/api/home/projects/demo", "", true), 200)
	if len(after.Todos) != 0 {
		t.Fatal("question todo persisted")
	}
	messages, err := s.DB.HomeMessages(context.Background(), "demo")
	if err != nil || len(messages) != 1 || !strings.HasPrefix(messages[0].Text, "回复汇报《Approval》：Approved") {
		t.Fatal(messages, err)
	}
}
