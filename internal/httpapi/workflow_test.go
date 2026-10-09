package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jiangmuran/vibepanel/internal/parthenon"
	"github.com/jiangmuran/vibepanel/internal/store"
)

func TestProjectDiscussionIsPersistentButDoesNotApplyProposals(t *testing.T) {
	ts, s := newTestServer(t)
	ctx := context.Background()
	if _, err := s.DB.CreateProject(ctx, "p", "Project", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	s.WorkflowRunner = func(_ context.Context, _ store.ModelAssignment, _ string, prompt string, write bool) (parthenon.Answer, error) {
		if write {
			t.Error("discussion received write permission")
		}
		return parthenon.Answer{Text: `{"reply":"A proposal","proposal":{"projectId":"other","goal":"new goal","rev":900,"tasks":[],"stages":[]}}`}, nil
	}
	req, _ := http.NewRequest("POST", ts.URL+"/api/projects/p/discussion", strings.NewReader(`{"message":"plan next stage","executor":{"harness":"codex","model":"fixture"}}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("discussion status %d", res.StatusCode)
	}
	var m store.WorkflowMessage
	if err = json.NewDecoder(res.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	if m.Proposal == nil || m.Proposal.ProjectID != "p" || m.Proposal.Rev != 0 {
		t.Fatalf("proposal escaped context: %+v", m)
	}
	b, err := s.DB.GetProjectBoard(ctx, "p")
	if err != nil || b.Rev != 0 || b.Goal != "" {
		t.Fatalf("proposal mutated board: %+v %v", b, err)
	}
	v, err := s.DB.WorkflowView(ctx, "p")
	if err != nil || len(v.Messages) != 2 {
		t.Fatalf("messages not durable: %+v %v", v, err)
	}
}
