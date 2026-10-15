package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jiangmuran/vibepanel/internal/selfupdate"
	"github.com/jiangmuran/vibepanel/internal/version"
)

type updateTransport func(*http.Request) (*http.Response, error)

func (f updateTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Count every attempted request, including downloads, without reaching GitHub
// even if a guard regresses. An old database row must not become an offer just
// because the running Pantheon version sorts below the upstream release.
func TestManagedUpdateIgnoresSavedReleasesAndNeverChecks(t *testing.T) {
	was := version.Version
	version.Version = "v1.25.0-pantheon.1"
	t.Cleanup(func() { version.Version = was })
	for _, source := range []string{"never checked", "database", "memory"} {
		t.Run(source, func(t *testing.T) {
			srv := newUpdateTestServer(t)
			srv.updateChannel = nil
			var requests, probes atomic.Int32
			srv.Updater.HTTP = &http.Client{Transport: updateTransport(func(*http.Request) (*http.Response, error) {
				requests.Add(1)
				return nil, errors.New("unexpected update request")
			})}
			srv.installable = func() error {
				probes.Add(1)
				return selfupdate.ErrNotWritable
			}
			rec := &checkRecord{At: 1, Release: selfupdate.Release{
				Version: "v1.29.1", Newer: true, Asset: "https://example.invalid/upstream.tar.gz",
				URL: "https://github.com/jiangmuran/vibepanel/releases/tag/v1.29.1", Notes: "upstream release",
			}}
			if source != "never checked" {
				raw, err := json.Marshal(rec)
				if err != nil {
					t.Fatal(err)
				}
				if err := srv.DB.SetSetting(t.Context(), updateLastCheckKey, string(raw)); err != nil {
					t.Fatal(err)
				}
			}
			if source == "memory" {
				srv.updates = updateState{loaded: true, last: rec, job: &updateJob{Stage: "failed", Version: "v1.29.1"}}
			}
			if err := srv.DB.SetSetting(t.Context(), updateAutoCheckKey, "1"); err != nil {
				t.Fatal(err)
			}
			want := updateStatus{Current: version.Version, Platform: selfupdate.Platform(), Managed: true}
			for _, path := range []string{"/api/update/status", "/api/update", "/api/update/status"} {
				code, body := updateRequest(t, srv, http.MethodGet, path, "")
				var got updateStatus
				if err := json.Unmarshal([]byte(body), &got); err != nil || code != http.StatusOK {
					t.Fatalf("%s: %d %s", path, code, body)
				}
				if !reflect.DeepEqual(got, want) {
					t.Errorf("%s: %+v, want managed status without a release, error or job", path, got)
				}
			}
			srv.maybeAutoCheck(t.Context())
			if got := srv.statusView(t.Context(), rec, true); !reflect.DeepEqual(got, want) {
				t.Errorf("a supplied stale record escaped the managed view: %+v", got)
			}
			// An accidentally scheduled background check must have time to hit
			// the transport before its absence is asserted.
			time.Sleep(50 * time.Millisecond)
			if requests.Load() != 0 || probes.Load() != 0 {
				t.Errorf("managed checks made %d requests and %d installability probes", requests.Load(), probes.Load())
			}
			code, body := updateRequest(t, srv, http.MethodPut, "/api/update/settings", `{"autoCheck":true}`)
			if code != http.StatusConflict || !strings.Contains(body, selfupdate.ErrManaged.Error()) {
				t.Errorf("a setting could enable managed updates: %d %s", code, body)
			}
		})
	}
}

func TestManagedUpdateRefusesBeforeInstallOrElevation(t *testing.T) {
	for _, writable := range []bool{true, false} {
		t.Run(fmt.Sprintf("writable=%v", writable), func(t *testing.T) {
			r := newSudoRig(t, "classic", "nopasswd")
			r.srv.updateChannel = nil // The shipped policy, not the upstream test override.
			var requests, probes, installs, restarts atomic.Int32
			r.srv.Updater.HTTP = &http.Client{Transport: updateTransport(func(*http.Request) (*http.Response, error) {
				requests.Add(1)
				return nil, errors.New("unexpected update request")
			})}
			r.srv.installable = func() error {
				probes.Add(1)
				if writable {
					return nil
				}
				return selfupdate.ErrNotWritable
			}
			r.srv.install = func([]byte, string) (string, error) {
				installs.Add(1)
				return "", errors.New("unexpected install")
			}
			r.srv.restartCmd = func() (*exec.Cmd, error) {
				restarts.Add(1)
				return nil, errors.New("unexpected restart")
			}
			for _, body := range []string{"", `{"expected":"v1.29.1","password":"unused-secret"}`, "invalid json"} {
				code, got := updateRequest(t, r.srv, http.MethodPost, "/api/update", body)
				if code != http.StatusConflict || !strings.Contains(got, selfupdate.ErrManaged.Error()) {
					t.Errorf("apply: %d %s, want 409 naming the deployment runbook", code, got)
				}
				if strings.Contains(got, "unused-secret") {
					t.Error("the managed refusal echoed a password")
				}
			}
			if requests.Load() != 0 || probes.Load() != 0 || installs.Load() != 0 || restarts.Load() != 0 {
				t.Errorf("managed apply reached the updater: requests=%d probes=%d installs=%d restarts=%d",
					requests.Load(), probes.Load(), installs.Load(), restarts.Load())
			}
			if r.srv.currentJob() != nil || len(r.records(t)) != 0 || r.ranCount(t, 0) != 0 {
				t.Error("managed apply started a job, sudo or the upgrade command")
			}
		})
	}
}

// A panel that cannot replace its own binary says so, before downloading, and
// names the command that can.
//
// The reported failure was the other order:
//
//	selfupdate: open /usr/local/bin/.vibepanel-update-2717682195: permission denied
//
// after the archive had been fetched, from a button that had offered to
// install it. A system install owns the binary as root and runs the panel as
// the user, so the answer was knowable before anything was downloaded.
//
// The check is behind a field here for one reason: the real one asks about the
// running executable, and in a test that is the test binary in a writable
// temp directory, so this branch is otherwise unreachable and shipped
// unexercised.
func TestAPanelThatCannotReplaceItsBinarySaysSoFirst(t *testing.T) {
	// Against a fake release, so the answer does not depend on whether this
	// machine can reach GitHub. It used to, and skipped on the runners that
	// could not.
	gh := newFakeGitHub(t, "v99.0.0", "new")
	srv, _ := updatable(t, gh)
	srv.installable = func() error {
		return fmt.Errorf("%w: /usr/local/bin", selfupdate.ErrNotWritable)
	}

	// The check tells the page not to offer the button, and carries the
	// sentence it should show instead.
	code, body := updateRequest(t, srv, http.MethodGet, "/api/update", "")
	if code != http.StatusOK {
		t.Fatalf("check: %d %s", code, body)
	}
	var out updateStatus
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if out.Unreachable != "" || !strings.Contains(out.ByHand, "service upgrade") {
		t.Errorf("the check does not name the command that can replace the binary: %+v", out)
	}

	// And applying refuses with 409 rather than a 500 from a temp file.
	code, said := updateRequest(t, srv, http.MethodPost, "/api/update", "")
	if code != http.StatusConflict {
		t.Fatalf("apply: %d %s, want 409", code, strings.TrimSpace(said))
	}
	if !strings.Contains(said, "service upgrade") {
		t.Errorf("the refusal does not name the command that works: %s", strings.TrimSpace(said))
	}
	if strings.Contains(said, ".vibepanel-update-") {
		t.Errorf("the refusal is still the raw temp-file error: %s", strings.TrimSpace(said))
	}
}

// The updater and the restart button answer the same question, and this puts
// the process in the case that told them apart.
//
// `INVOCATION_ID` is set by systemd on a unit and inherited by everything that
// unit goes on to spawn, so a panel built and started by hand from a pane of a
// vibepanel session has it. restart.go was fixed twice over exactly that, and
// the parent is the decisive half; the updater kept the old test, so for one
// process handleRestart answered 409 unsupervised while the updater reported
// `restarting: true` and shelled out to `systemctl --user restart vibepanel` --
// which, on a machine that does have a unit installed, restarts a different,
// production panel and drops every browser and terminal on it, for an update
// nobody applied to it.
func TestTheUpdaterRestartsOnlyWhereTheButtonWould(t *testing.T) {
	t.Setenv("INVOCATION_ID", "03636ea867064621b23c72f3d5c96b02")
	t.Setenv("XDG_RUNTIME_DIR", "/run/user/1000")
	if who := supervisorName(); who != "" {
		// A test binary's parent is the go tool or a shell, never a service
		// manager -- unless this really is running under one, in which case
		// there is nothing here to disagree about.
		t.Skipf("this process really is supervised by %s", who)
	}
	if cmd, err := restartCommand(); err == nil {
		t.Fatalf("the updater would run %q, while the restart button refuses this process as unsupervised", cmd.String())
	}

	// And the arms that do restart still do. The user unit is the install this
	// project recommends wherever there is no root, so losing it here would
	// leave all of those installing an update and never restarting into it.
	cmd, err := restartCommandFor("systemd")
	if err != nil {
		t.Fatalf("a systemd user unit: %v", err)
	}
	if got := strings.Join(cmd.Args[1:], " "); got != "--user restart vibepanel" {
		t.Errorf("a systemd user unit: %q, want `--user restart vibepanel`", got)
	}
	if _, err := restartCommandFor("launchd"); err == nil {
		t.Error("launchd got a systemctl command")
	}
}

// TestASuppliedSecretIsRefusedWhereItWouldNotBeUsed.
//
// Two directions, and the second is the one worth having.
//
// A panel that can write its own binary needs nothing typed, so a request that
// carries something is refused rather than quietly having it ignored: a
// credential sent for no reason is still a credential that travelled, and the
// caller has to be told it was pointless so they stop sending it.
//
// And a panel that cannot write its binary, for a reason that is *not*
// permissions -- a full disk, a read-only mount -- must not take one either.
// Nothing typed would help, and spending it on a program that is going to fail
// anyway is the worst of both.
func TestASuppliedSecretIsRefusedWhereItWouldNotBeUsed(t *testing.T) {
	srv := newUpdateTestServer(t)

	// Writable: nothing to authorise.
	srv.installable = func() error { return nil }
	code, body := updateRequest(t, srv, http.MethodPost, "/api/update", `{"password":"hunter2"}`)
	if code != http.StatusBadRequest {
		t.Errorf("a writable panel took a password: %d %s", code, body)
	}
	if strings.Contains(body, "hunter2") {
		t.Errorf("the refusal echoed what was sent: %s", body)
	}

	// Not writable, but not a permissions problem either.
	srv.installable = func() error { return errors.New("no space left on device") }
	code, body = updateRequest(t, srv, http.MethodPost, "/api/update", `{"password":"hunter2"}`)
	if code != http.StatusConflict {
		t.Errorf("a full disk took a password: %d %s", code, body)
	}
	if strings.Contains(body, "hunter2") {
		t.Errorf("the refusal echoed what was sent: %s", body)
	}
}
