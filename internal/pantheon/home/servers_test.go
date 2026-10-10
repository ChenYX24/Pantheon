package home

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestHomeSSHAliasesIncludesWildcardsAndNoOtherFields(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, ".ssh/config")
	put(t, config, "# comment\nHost first second wild* ?wild !negated [abc] -option\n HostName private-address\n User private-user\n IdentityFile private-identity\n Include = \"parts/*.conf\"\n Match exec \"must-not-run\"\n Host final # comment\n")
	put(t, filepath.Join(dir, ".ssh/parts/one.conf"), "host=third first\nInclude ~/extra.conf\n")
	put(t, filepath.Join(dir, "extra.conf"), "Host quoted\nInclude ~/.ssh/config\n")
	aliases, err := SSHAliases(config)
	if err != nil || !reflect.DeepEqual(aliases, []string{"final", "first", "quoted", "second", "third"}) {
		t.Fatalf("%+v %v", aliases, err)
	}
	aliases, err = SSHAliases(filepath.Join(dir, "missing"))
	if err != nil || len(aliases) != 0 {
		t.Fatalf("%+v %v", aliases, err)
	}
}

func TestHomeBoardProjectionPrivacyAndFixedClock(t *testing.T) {
	now := time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "snapshot.json")
	put(t, path, `{"version":1,"collected_at":"2026-10-10T10:00:00Z","identity":"private-identity","nodes":[
{"id":"gpu-a","alias":"alias-a","group":"atombit","label":"GPU A","state":"fresh","reachability":"connected","telemetry":"ok","last_success_at":"2026-10-10T09:59:00Z","last_metrics_at":"2026-10-10T09:57:00Z","identity":"private-identity","address":"private-address","user":"private-user","stderr":"private-stderr","gpus":[{"index":0,"name":"GPU","memory_total_mib":24000,"memory_used_mib":100,"utilization_pct":0,"temperature_c":40,"power_w":30,"mig_mode":"disabled","observation":"low_usage","uuid":"private-uuid"}]},
{"id":"gpu-old","state":"fresh","reachability":"connected","last_metrics_at":"2026-10-10T09:56:59Z","gpus":[{"index":0,"observation":"low_usage"}]},
{"id":"off","state":"fresh","reachability":"disconnected","last_metrics_at":"2026-10-10T09:59:00Z","error_code":"ssh_timeout"},
{"id":"unsupported","telemetry":"unsupported"},
{"id":"unknown"}]}`)
	servers, board := ReadBoardSnapshot(path, "https://board.invalid", now)
	if !board.Available || board.StaleAfterSeconds != 180 || board.CollectedAt == nil || len(servers) != 5 {
		t.Fatalf("%+v %+v", servers, board)
	}
	for n, want := range []string{"fresh", "stale", "disconnected", "unsupported", "unknown"} {
		if servers[n].State != want {
			t.Errorf("node %d: %s want %s", n, servers[n].State, want)
		}
	}
	if servers[0].GPUs[0].Observation != "low_usage" || servers[1].GPUs[0].Observation != "unknown" || *servers[0].GPUs[0].MemoryTotalMib != 24000 || *servers[0].AgeSeconds != 180 {
		t.Fatalf("%+v", servers)
	}
	raw, _ := json.Marshal(servers)
	for _, private := range []string{"identity", "uuid", "address", "user", "stderr", "private-"} {
		if strings.Contains(string(raw), private) {
			t.Fatal("projection disclosed", private)
		}
	}
	later, _ := ReadBoardSnapshot(path, "", now.Add(time.Second))
	if later[0].State != "stale" || later[0].GPUs[0].Observation != "unknown" {
		t.Fatal("old snapshot stayed fresh")
	}
}

func TestHomeBoardMissingOrUnknownSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.json")
	for _, raw := range []string{"", `{}`, `{"version":2,"collected_at":"2026-10-10T10:00:00Z","nodes":[]}`, `{"collected_at":"bad","nodes":[]}`, `{"collected_at":"2026-10-10T10:00:00Z","nodes":[{}]}`} {
		if raw != "" {
			put(t, path, raw)
		}
		servers, board := ReadBoardSnapshot(path, "", time.Now())
		if board.Available || len(servers) != 0 {
			t.Fatalf("accepted %s", raw)
		}
	}
}
