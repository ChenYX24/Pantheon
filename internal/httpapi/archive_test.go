package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/store"
)

func stateNow(t *testing.T, srv *Server) stateResponse {
	t.Helper()
	st, err := srv.buildState(context.Background())
	if err != nil {
		t.Fatalf("buildState: %v", err)
	}
	return st
}

// The whole feature in one test: archiving takes a project and its sessions
// out of what every viewer is sent, leaves the process running, and restoring
// puts back the same project with the same session in it.
func TestArchivingHidesAProjectWithoutEndingItsSessions(t *testing.T) {
	ts, srv := newTestServer(t)
	ctx := context.Background()
	project := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"old"}`)
	sess := postJSON[store.Session](t, ts, "/api/sessions", `{"projectId":"`+project.ID+`","command":["sleep","60"]}`)
	other := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"current"}`)

	got := postJSON[store.Project](t, ts, "/api/projects/"+project.ID+"/archive", `{}`)
	if got.ArchivedAt == nil || got.ArchivedAuto {
		t.Fatalf("archive answered %+v; want archived by hand", got)
	}

	st := stateNow(t, srv)
	if len(st.Projects) != 1 || st.Projects[0].ID != other.ID {
		t.Errorf("snapshot projects = %+v, want only %s", st.Projects, other.ID)
	}
	for _, s := range st.Sessions {
		if s.ID == sess.ID {
			t.Error("the archived project's session is still in the snapshot")
		}
	}
	if len(st.Archived) != 1 || st.Archived[0].ID != project.ID || st.Archived[0].Sessions != 1 {
		t.Fatalf("snapshot archived = %+v, want the project with its one running session", st.Archived)
	}
	alive, err := srv.Tmux.Has(ctx, sess.TmuxName)
	if err != nil || !alive {
		t.Fatalf("archiving ended the session's tmux session: alive=%v err=%v", alive, err)
	}

	back := postJSON[store.Project](t, ts, "/api/projects/"+project.ID+"/restore", `{}`)
	if back.ID != project.ID || back.ArchivedAt != nil {
		t.Fatalf("restore answered %+v", back)
	}
	st = stateNow(t, srv)
	if len(st.Projects) != 2 || len(st.Archived) != 0 {
		t.Errorf("after restore: %d projects, %d archived; want 2 and 0", len(st.Projects), len(st.Archived))
	}
	found := false
	for _, s := range st.Sessions {
		found = found || s.ID == sess.ID
	}
	if !found {
		t.Error("the session did not come back with its project")
	}
}

// Choosing an archived project's directory in the picker is how somebody
// brings it back; the server does the restoring so a script or a stale tab
// gets the same answer rather than a second project on the same tree.
func TestAddingAnArchivedProjectsDirectoryRestoresIt(t *testing.T) {
	ts, srv := newTestServer(t)
	dir := t.TempDir()
	project := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+dir+`","name":"old"}`)
	postJSON[store.Project](t, ts, "/api/projects/"+project.ID+"/archive", `{}`)

	code, body := doJSON(t, ts, http.MethodPost, "/api/projects", `{"path":"`+dir+`"}`)
	if code != http.StatusOK {
		t.Fatalf("adding the directory again = %d %s; want 200, nothing created", code, body)
	}
	var got store.Project
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != project.ID || got.ArchivedAt != nil {
		t.Errorf("got %+v, want %s restored", got, project.ID)
	}
	all, _ := srv.DB.ListAllProjects(context.Background())
	if len(all) != 1 {
		t.Errorf("%d projects exist; the directory was added beside its archived self", len(all))
	}
}

func TestASessionCannotStartInAnArchivedProject(t *testing.T) {
	ts, _ := newTestServer(t)
	project := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"old"}`)
	postJSON[store.Project](t, ts, "/api/projects/"+project.ID+"/archive", `{}`)
	code, body := doJSON(t, ts, http.MethodPost, "/api/sessions", `{"projectId":"`+project.ID+`","command":["sleep","60"]}`)
	if code != http.StatusConflict {
		t.Errorf("starting a session in an archived project = %d %s; want 409", code, body)
	}
}

// Off unless somebody turns it on, and then it archives what has been idle
// for the chosen number of days and marks it as its own doing.
func TestTheIdleRuleRunsOnlyWhenTurnedOn(t *testing.T) {
	ts, srv := newTestServer(t)
	ctx := context.Background()
	project := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"quiet"}`)
	later := time.Now().Add(100 * 24 * time.Hour)

	if n := srv.archiveIdleOnce(ctx, later); n != 0 {
		t.Fatalf("the idle rule archived %d projects with the setting unset", n)
	}

	if code, body := doJSON(t, ts, http.MethodPut, "/api/settings/archive", `{"days":1}`); code != http.StatusBadRequest {
		t.Errorf("days=1 = %d %s; want 400, it is not one of the offered values", code, body)
	}
	if code, body := doJSON(t, ts, http.MethodPut, "/api/settings/archive", `{"days":30}`); code != http.StatusOK {
		t.Fatalf("days=30 = %d %s", code, body)
	}
	if n := srv.archiveIdleOnce(ctx, time.Now()); n != 0 {
		t.Fatalf("a project made a moment ago was archived as idle")
	}
	if n := srv.archiveIdleOnce(ctx, later); n != 1 {
		t.Fatalf("archived %d, want the one idle project", n)
	}
	p, _ := srv.DB.GetProject(ctx, project.ID)
	if p.ArchivedAt == nil || !p.ArchivedAuto {
		t.Errorf("after the idle rule: %+v; want archived, automatically", p)
	}
}

// A wall is told about what the sidebar shows. A site-wide link counting the
// sessions of an archived project would show work nobody can find.
func TestAWallDoesNotCountAnArchivedProjectsSessions(t *testing.T) {
	ts, _ := newTestServer(t)
	shown := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"shown"}`)
	hidden := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"hidden"}`)
	postJSON[store.Session](t, ts, "/api/sessions", `{"projectId":"`+shown.ID+`","command":[]}`)
	postJSON[store.Session](t, ts, "/api/sessions", `{"projectId":"`+hidden.ID+`","command":[]}`)
	postJSON[store.Project](t, ts, "/api/projects/"+hidden.ID+"/archive", `{}`)

	link := newShare(t, ts, `{"name":"wall"}`)
	res, body := shareGET(t, ts, link.Token)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("snapshot = %d: %s", res.StatusCode, body)
	}
	got := decodeSnapshot(t, body)
	if got.Counts.Sessions != 1 || got.Counts.Projects != 1 {
		t.Errorf("wall counts %d sessions in %d projects; want 1 in 1", got.Counts.Sessions, got.Counts.Projects)
	}
}

// A phone is told about what the sidebar shows. The archived project's agent
// finishes first; the visible one's card arriving afterwards is what makes
// "nothing came for the hidden one" a fact rather than a race lost early.
func TestAnArchivedProjectsSessionsDoNotReachAPhone(t *testing.T) {
	ts, srv := newTestServer(t)
	ad := attachChat(t, srv)
	ctx := context.Background()
	shown := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"shown"}`)
	hidden := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"hidden"}`)
	a := postJSON[store.Session](t, ts, "/api/sessions", `{"projectId":"`+shown.ID+`","command":["sleep","60"]}`)
	b := postJSON[store.Session](t, ts, "/api/sessions", `{"projectId":"`+hidden.ID+`","command":["sleep","60"]}`)
	postJSON[store.Project](t, ts, "/api/projects/"+hidden.ID+"/archive", `{}`)
	token, _ := srv.HookToken(ctx)
	if err := srv.DB.PutChatPeer(ctx, store.ChatPeer{Channel: "mem", PeerID: "me", Status: store.PeerPaired, Mode: store.ModeNormal}); err != nil {
		t.Fatal(err)
	}
	report := func(id, msg string) {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/hook/state?sessionId="+id+"&state=done",
			strings.NewReader(`{"hook_event_name":"Stop","last_assistant_message":"`+msg+`"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
	}
	report(b.ID, "hidden finished")
	time.Sleep(400 * time.Millisecond) // past the bridge's coalescing window
	report(a.ID, "shown finished")

	deadline := time.Now().Add(5 * time.Second)
	for {
		ad.mu.Lock()
		var bodies []string
		for _, m := range ad.sent {
			if m.Card != nil {
				bodies = append(bodies, m.Card.Body)
			}
		}
		ad.mu.Unlock()
		joined := strings.Join(bodies, "\n")
		if strings.Contains(joined, "hidden finished") {
			t.Fatalf("an archived project's session was pushed to the phone: %q", joined)
		}
		if strings.Contains(joined, "shown finished") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the visible session's card never arrived: %q", joined)
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Waiting is the exception: hiding a project is not asking to miss the
	// agent in it that stopped for a decision.
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/hook/state?sessionId="+b.ID+"&state=waiting",
		strings.NewReader(`{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"hidden asks"}}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	if res, err := ts.Client().Do(req); err == nil {
		res.Body.Close()
	}
	deadline = time.Now().Add(5 * time.Second)
	for {
		ad.mu.Lock()
		var joined string
		for _, m := range ad.sent {
			if m.Card != nil {
				joined += m.Card.Body + "\n"
			}
		}
		ad.mu.Unlock()
		if strings.Contains(joined, "hidden asks") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("a session waiting in an archived project never reached the phone: %q", joined)
		}
		time.Sleep(20 * time.Millisecond)
	}

	code, body := doJSON(t, ts, http.MethodGet, "/api/chat", "")
	if code != http.StatusOK {
		t.Fatalf("GET /api/chat = %d", code)
	}
	var view struct {
		Sessions []struct {
			ID string `json:"id"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(body, &view); err != nil {
		t.Fatal(err)
	}
	for _, s := range view.Sessions {
		if s.ID == b.ID {
			t.Error("the chat page lists an archived project's session")
		}
	}
}

// A link scoped to something in an archived project is still about something
// that exists: it names it and shows nothing running, rather than reading as a
// link to a project or session that was deleted.
func TestAScopedLinkIntoAnArchivedProjectStillResolves(t *testing.T) {
	ts, _ := newTestServer(t)
	p := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"shelved"}`)
	one := postJSON[store.Session](t, ts, "/api/sessions",
		`{"projectId":"`+p.ID+`","title":"still going","command":["sleep","60"]}`)
	byProject := shareOn(t, ts, sessionsManifest, `{"name":"p","detail":"names","scope":"project","scopeId":"`+p.ID+`"}`)
	bySession := shareOn(t, ts, sessionsManifest, `{"name":"s","detail":"names","scope":"session","scopeId":"`+one.ID+`"}`)
	postJSON[store.Project](t, ts, "/api/projects/"+p.ID+"/archive", `{}`)

	for _, c := range []struct {
		name, token, scopeName string
	}{
		{"project", byProject.Token, "shelved"},
		{"session", bySession.Token, "still going"},
	} {
		_, body := shareGET(t, ts, c.token)
		got := decodeSnapshot(t, body)
		if got.ScopeName != c.scopeName {
			t.Errorf("%s-scoped link: scopeName = %q, want %q -- it reads as deleted", c.name, got.ScopeName, c.scopeName)
		}
		if got.Counts.Sessions != 0 || len(got.Sessions) != 0 {
			t.Errorf("%s-scoped link shows %d sessions of an archived project", c.name, got.Counts.Sessions)
		}
	}
}

// Webhooks follow the phone: an archived project's sessions are not reported,
// except when one is waiting for its person.
func TestWebhooksSkipAnArchivedProjectUnlessASessionIsWaiting(t *testing.T) {
	var mu sync.Mutex
	var got []string
	dest := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = append(got, r.URL.Query().Get("s"))
		mu.Unlock()
	}))
	defer dest.Close()

	ts, srv := newTestServer(t)
	ctx := context.Background()
	p := postJSON[store.Project](t, ts, "/api/projects", `{"path":"`+t.TempDir()+`","name":"shelved"}`)
	sess := postJSON[store.Session](t, ts, "/api/sessions", `{"projectId":"`+p.ID+`","command":["sleep","60"]}`)
	if code, body := doJSON(t, ts, http.MethodPut, "/api/settings/webhooks",
		`[{"name":"phone","method":"GET","url":"`+dest.URL+`/x?s={state}","states":["waiting","done"],"enabled":true}]`); code != http.StatusOK {
		t.Fatalf("put webhooks: %d %s", code, body)
	}
	postJSON[store.Project](t, ts, "/api/projects/"+p.ID+"/archive", `{}`)
	token, _ := srv.HookToken(ctx)
	report := func(state string) {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/hook/state",
			strings.NewReader(`{"sessionId":"`+sess.ID+`","state":"`+state+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := ts.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
	}
	report("done")
	report("waiting")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(200 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0] != "waiting" {
		t.Errorf("webhook calls for an archived project = %v, want only [waiting]", got)
	}
}
