package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/pantheon/home"
	"github.com/jiangmuran/vibepanel/internal/parthenon"
	"github.com/jiangmuran/vibepanel/internal/store"
)

type homeTurn struct {
	User      store.HomeMessage `json:"user"`
	Assistant store.HomeMessage `json:"assistant"`
}

func waitHomeTurn(t *testing.T, s *Server, pid, thread, message string) store.HomeMessage {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		messages, err := s.DB.HomeMessages(context.Background(), pid, thread)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range messages {
			if m.ID == message && m.Status != "pending" {
				return m
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("discussion did not finish")
	return store.HomeMessage{}
}

func TestHomeAsyncDiscussionThreadsAndRetry(t *testing.T) {
	s := newInProcessTestServer(t)
	project := homeFixture(t, s)
	s.Cfg.Development = true
	homePut(t, filepath.Join(project, "agent-docs/tasks/A2/task.md"), "---\nid: A2\ntitle: Backend\nstatus: in_progress\n---\n")
	path := "/api/home/projects/demo"
	threads := homeDecode[struct {
		Threads []store.HomeThread `json:"threads"`
	}](t, homeRequest(t, s, "GET", path+"/threads", "", true), 200)
	if len(threads.Threads) != 1 || threads.Threads[0].ID != "main" {
		t.Fatal(threads)
	}
	thread := homeDecode[store.HomeThread](t, homeRequest(t, s, "POST", path+"/threads", `{}`, true), 201)
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	s.WorkflowRunner = func(ctx context.Context, m store.ModelAssignment, dir, prompt string, write bool) (parthenon.Answer, error) {
		n := calls.Add(1)
		if write || dir != s.Cfg.DataDir || m.Model != "custom" || !strings.Contains(prompt, "Backend") {
			return parthenon.Answer{}, errors.New("wrong runner context")
		}
		if _, ok := ctx.Deadline(); !ok {
			return parthenon.Answer{}, errors.New("no timeout")
		}
		if n == 1 {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return parthenon.Answer{}, ctx.Err()
			}
			return parthenon.Answer{}, errors.New("offline")
		}
		return parthenon.Answer{Text: "```json\n" + `{"reply":"Ready","suggestions":[{"type":"set_fields","taskId":"A2","fields":{"priority":"P1"}},{"type":"set_project","fields":{"phase":"开发"}},{"type":"reply_report","file":"q.md","text":"Proceed"}]}` + "\n```"}, nil
	}
	req := `{"message":"状态如何？","executor":{"harness":"codex","model":"custom"},"thread":"` + thread.ID + `"}`
	turn := homeDecode[homeTurn](t, homeRequest(t, s, "POST", path+"/discussion", req, true), 202)
	if turn.Assistant.Status != "pending" || turn.User.Status != "done" {
		t.Fatal(turn)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("runner not started")
	}
	homeDecode[map[string]any](t, homeRequest(t, s, "POST", path+"/discussion", `{"message":"other thread","executor":{"harness":"codex","model":"custom"}}`, true), 409)
	homeDecode[map[string]any](t, homeRequest(t, s, "POST", path+"/discussion/"+turn.Assistant.ID+"/retry", `{}`, true), 409)
	close(release)
	failed := waitHomeTurn(t, s, "demo", thread.ID, turn.Assistant.ID)
	if failed.Status != "failed" || failed.Error == nil || *failed.Error != "offline" {
		t.Fatal(failed)
	}
	retry := homeDecode[homeTurn](t, homeRequest(t, s, "POST", path+"/discussion/"+failed.ID+"/retry", `{}`, true), 202)
	done := waitHomeTurn(t, s, "demo", thread.ID, retry.Assistant.ID)
	if done.ID != failed.ID || done.Status != "done" || done.Text != "Ready" || !strings.Contains(string(done.Suggestions), "reply_report") {
		t.Fatal(done)
	}
	history := homeDecode[struct {
		Messages []store.HomeMessage `json:"messages"`
	}](t, homeRequest(t, s, "GET", path+"/discussion?thread="+thread.ID, "", true), 200)
	if len(history.Messages) != 2 || calls.Load() != 2 {
		t.Fatal("retry appended", history, calls.Load())
	}
	detail := homeDecode[home.Detail](t, homeRequest(t, s, "GET", path, "", true), 200)
	if detail.Tasks[0].Priority != "" || detail.Project.Meta.Phase != "" {
		t.Fatal("suggestions applied")
	}
	renamed := homeDecode[store.HomeThread](t, homeRequest(t, s, "PATCH", path+"/threads/"+thread.ID, `{"title":"Review"}`, true), 200)
	if renamed.Title != "Review" || renamed.MessageCount != 2 {
		t.Fatal(renamed)
	}
	homeDecode[map[string]any](t, homeRequest(t, s, "DELETE", path+"/threads/main", "", true), 400)
	if w := homeRequest(t, s, "DELETE", path+"/threads/"+thread.ID, "", true); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	homeDecode[map[string]any](t, homeRequest(t, s, "GET", path+"/discussion?thread="+thread.ID, "", true), 404)
	if reply := parseHomeReply("plain reply"); reply.Reply != "plain reply" || len(reply.Suggestions) != 0 {
		t.Fatal(reply)
	}
}

func TestHomeDiscussionPromptContainsFilesTasksAndGit(t *testing.T) {
	s := newInProcessTestServer(t)
	project := homeFixture(t, s)
	homePut(t, filepath.Join(project, "ACTIVE_CONTEXT.md"), "- **Goal**: Ship home\nEvidence outside the goal bullet\n"+strings.Repeat("x", 17000))
	homePut(t, filepath.Join(project, "MEMORY.md"), "Remember this decision\n"+strings.Repeat("y", 9000))
	homePut(t, filepath.Join(project, "agent-docs/tasks/A2/task.md"), "---\nid: A2\ntitle: Table task\nstatus: blocked\npriority: P1\ntags: [后端]\nowner: codex\nprimary: codex/custom\nsecondary: claude/custom\nupdated: 2026-10-10T01:00:00+08:00\n---\n")
	homePut(t, filepath.Join(s.Cfg.DataDir, "tracked.txt"), "first\n")
	t.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	for _, args := range [][]string{{"init", "-q"}, {"add", "tracked.txt"}, {"-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture commit evidence"}} {
		cmd := exec.Command("git", append([]string{"-C", s.Cfg.DataDir}, args...)...)
		if data, err := cmd.CombinedOutput(); err != nil {
			t.Fatal(err, string(data))
		}
	}
	homePut(t, filepath.Join(s.Cfg.DataDir, "tracked.txt"), "changed\n")
	detail := s.Home.Snapshot(s.Cfg.CyxHome, true, nil).Details["demo"]
	prompt := homeDiscussionPrompt(detail, nil, "status") + homeGitContext(context.Background(), detail.Project)
	for _, part := range []string{"Evidence outside the goal bullet", "Remember this decision", "Table task", "P1", "后端", "codex/custom", "Fixture commit evidence", " M tracked.txt"} {
		if !strings.Contains(prompt, part) {
			t.Fatal("missing prompt evidence", part)
		}
	}
	if len(detail.ActiveContext) > 16<<10 || len(detail.Memory) > 8<<10 {
		t.Fatal("unbounded context")
	}
}

func TestHomeDeletingPendingThreadCancelsRun(t *testing.T) {
	s := newInProcessTestServer(t)
	homeFixture(t, s)
	thread := homeDecode[store.HomeThread](t, homeRequest(t, s, "POST", "/api/home/projects/demo/threads", `{}`, true), 201)
	started, stopped := make(chan struct{}), make(chan struct{})
	s.WorkflowRunner = func(ctx context.Context, _ store.ModelAssignment, _ string, _ string, _ bool) (parthenon.Answer, error) {
		close(started)
		<-ctx.Done()
		close(stopped)
		return parthenon.Answer{}, ctx.Err()
	}
	req := `{"message":"wait","executor":{"harness":"codex","model":"test"},"thread":"` + thread.ID + `"}`
	homeDecode[homeTurn](t, homeRequest(t, s, "POST", "/api/home/projects/demo/discussion", req, true), 202)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("runner not started")
	}
	if w := homeRequest(t, s, "DELETE", "/api/home/projects/demo/threads/"+thread.ID, "", true); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	select {
	case <-stopped:
	default:
		t.Fatal("deleted thread left a process")
	}
	messages, err := s.DB.HomeMessages(context.Background(), "demo")
	if err != nil || len(messages) != 0 {
		t.Fatal(messages, err)
	}
}

func TestHomeReplyJSONCanContainMarkdownFences(t *testing.T) {
	text := "Example:\n```go\nvar x = 1\n```"
	raw, err := json.Marshal(homeReply{Reply: text})
	if err != nil {
		t.Fatal(err)
	}
	for _, answer := range []string{string(raw), "```json\n" + string(raw) + "\n```", "Here is the reply:\n```json\n" + string(raw) + "\n```"} {
		if got := parseHomeReply(answer); got.Reply != text {
			t.Fatalf("fenced JSON: %+v", got)
		}
	}
}
