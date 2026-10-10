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
	// The private snapshot exactly as atombit-gpu-board's collector writes it
	// (runtime/snapshot.json): reachability and telemetry, never a state, and
	// fields the public projection must drop.
	now := time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "snapshot.json")
	put(t, path, `{"schema_version":1,"collected_at":"2026-10-10T10:00:00Z","origin":"collector","duration_seconds":12,"nodes":[
{"id":"gpu-a","alias":"alias-a","group":"atombit","label":"GPU A","reachability":"connected","telemetry":"healthy","last_attempt_at":"2026-10-10T09:59:00Z","last_success_at":"2026-10-10T09:59:00Z","last_metrics_at":"2026-10-10T09:57:01Z","identity":{"hostname":"private-host","user":"private-user"},"error_code":null,"gpus":[
 {"index":0,"name":"A800","memory_total_mib":81920,"memory_used_mib":64,"utilization_pct":0,"temperature_c":40,"power_w":60,"mig_mode":"Disabled","uuid":"private-uuid-0"},
 {"index":1,"name":"A800","memory_total_mib":81920,"memory_used_mib":40000,"utilization_pct":97,"temperature_c":70,"power_w":300,"mig_mode":"Disabled","uuid":"private-uuid-1"}]},
{"id":"gpu-old","reachability":"connected","telemetry":"healthy","last_success_at":"2026-10-10T09:59:00Z","last_metrics_at":"2026-10-10T09:56:59Z","gpus":[{"index":0,"memory_used_mib":0,"utilization_pct":0}]},
{"id":"timeout","state":"fresh","reachability":"timeout","telemetry":"healthy","last_success_at":"2026-10-10T09:59:00Z","last_metrics_at":"2026-10-10T09:59:00Z","error_code":"ssh_timeout"},
{"id":"auth","reachability":"auth_failed","telemetry":"unknown","error_code":"auth_failed"},
{"id":"unsupported","reachability":"connected","telemetry":"unsupported","last_success_at":"2026-10-10T09:59:00Z"},
{"id":"unknown","reachability":"unknown"}]}`)
	servers, board := ReadBoardSnapshot(path, "https://board.invalid", now)
	if !board.Available || board.StaleAfterSeconds != 180 || board.CollectedAt == nil || len(servers) != 6 {
		t.Fatalf("%+v %+v", servers, board)
	}
	for n, want := range []string{"fresh", "stale", "disconnected", "disconnected", "unsupported", "unknown"} {
		if servers[n].State != want {
			t.Errorf("node %d (%s): %s want %s", n, servers[n].ID, servers[n].State, want)
		}
	}
	gpus := servers[0].GPUs
	if gpus[0].Observation != "low_usage" || gpus[1].Observation != "usage_observed" || servers[1].GPUs[0].Observation != "unknown" || *gpus[0].MemoryTotalMib != 81920 || gpus[0].MIGMode != "Disabled" || *servers[0].AgeSeconds != 179 {
		t.Fatalf("%+v", servers)
	}
	if servers[2].ErrorCode == nil || *servers[2].ErrorCode != "ssh_timeout" {
		t.Fatal("error code lost")
	}
	raw, _ := json.Marshal(servers)
	for _, private := range []string{"uuid", "private-", "hostname"} {
		if strings.Contains(string(raw), private) {
			t.Fatal("projection disclosed", private)
		}
	}
	later, _ := ReadBoardSnapshot(path, "", now.Add(time.Second))
	if later[0].State != "stale" || later[0].GPUs[0].Observation != "unknown" {
		t.Fatal("metrics older than 180 s stayed fresh")
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
