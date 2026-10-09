#!/usr/bin/env python3
"""Operate only the isolated Parthenon development instance, without sudo."""
import argparse
import fcntl
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
DATA = Path.home() / ".local/share/panel-dev"
PORT = 19444
BASE_PATH = "/dev"
BASE = f"http://127.0.0.1:{PORT}{BASE_PATH}"
PUBLIC = "https://parthenon.atombit.top/dev"
CADDY = "http://127.0.0.1:2019"
ROUTES = "/config/apps/http/servers/srv0/routes"
ROUTE_ID = "parthenon_dev"
PUBLICATION = DATA / "published.json"
CRON_MARKER = "# parthenon-dev-managed"
BINARY = DATA / "bin/parthenon-dev"
PID_FILE = DATA / "process.json"
ACCOUNT = DATA / "account.json"
ENV = {k: v for k, v in os.environ.items() if not k.startswith("VIBEPANEL_")}


def private_json(path, value):
    temporary = path.with_suffix(".tmp")
    with open(temporary, "w", encoding="utf-8", opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
    temporary.replace(path)


def identity(pid):
    try:
        # The process start tick prevents a stale PID from identifying a new process.
        stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        command = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        return {"pid": pid, "start": stat[19], "command": [arg.decode() for arg in command if arg]}
    except (OSError, IndexError):
        return None


def running():
    if not PID_FILE.exists():
        return None
    saved = json.loads(PID_FILE.read_text())
    current = identity(saved["pid"])
    if current == saved and current["command"][0] == str(BINARY) and "--development" in current["command"]:
        return saved
    return None


def start(refresh_binary=True):
    if running():
        print(f"Development panel is already running: {BASE}/projects")
        return
    if refresh_binary and not (ROOT / "vibepanel").is_file():
        raise RuntimeError("Build the development binary first with make build")
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", PORT))
    BINARY.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if refresh_binary:
        shutil.copy2(ROOT / "vibepanel", BINARY.with_suffix(".new"))
        BINARY.with_suffix(".new").replace(BINARY)
    elif not BINARY.is_file():
        raise RuntimeError("The verified private binary is missing; run start after building")
    if not ACCOUNT.exists():
        private_json(ACCOUNT, {"username": "parthenon-dev", "password": secrets.token_urlsafe(32)})
    account = json.loads(ACCOUNT.read_text())
    dbpath = DATA / "vibepanel.db"
    has_account = False
    if dbpath.exists():
        with sqlite3.connect(dbpath.as_uri() + "?mode=ro", uri=True) as db:
            has_account = db.execute("SELECT count(*) FROM users").fetchone()[0] > 0
    if not has_account:
        subprocess.run([str(BINARY), "account", "create", "--username", account["username"], "--password-stdin", "--", "--data-dir", str(DATA)], input=account["password"] + "\n", text=True, check=True, env=ENV, cwd=ROOT, stdout=subprocess.DEVNULL)
    with open(DATA / "server.log", "a", opener=lambda p, f: os.open(p, f, 0o600)) as log:
        process = subprocess.Popen([str(BINARY), "serve", "--development", "--base-path", BASE_PATH, "--trusted-proxies", "127.0.0.1/32", "--addr", f"127.0.0.1:{PORT}", "--data-dir", str(DATA), "--tmux-socket", "panel-dev", "--isolation", "off"], cwd=ROOT, env=ENV, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(f"Development process exited; inspect {DATA / 'server.log'}")
        current = identity(process.pid)
        if current:
            private_json(PID_FILE, current)
        try:
            with urllib.request.urlopen(BASE + "/api/auth/state", timeout=1) as response:
                if response.status == 200:
                    print(f"Development panel started: {BASE}/projects")
                    print(f"Login credentials (private local file): {ACCOUNT}")
                    return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("Development process did not become healthy within 10 seconds")


def stop_process():
    process = running()
    if not process:
        print("No managed development process is running")
        return
    os.kill(process["pid"], signal.SIGTERM)
    for _ in range(100):
        if not running():
            PID_FILE.unlink(missing_ok=True)
            print("Development panel stopped; its tmux sessions and data are preserved")
            return
        time.sleep(0.1)
    raise RuntimeError("Development process has not exited; no forced kill was attempted")


def client():
    account = json.loads(ACCOUNT.read_text())
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, payload=None, method=None):
        req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode() if payload is not None else None, headers={"Content-Type": "application/json"}, method=method)
        with opener.open(req, timeout=30) as response:
            return json.load(response)

    request("/api/auth/login", account)
    return request


def import_projects(source):
    request = client()
    if source.resolve() == (DATA / "vibepanel.db").resolve():
        raise RuntimeError("Import source must differ from the development database")
    # Metadata only; never copy authentication, configuration, sessions or conversations.
    with sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as db:
        rows = db.execute("SELECT name,path FROM projects WHERE archived_at IS NULL ORDER BY created_at").fetchall()
    existing = {p["path"] for p in request("/api/state")["projects"]}
    added = 0
    for name, path in rows:
        if path in existing or not Path(path).is_dir():
            continue
        request("/api/projects", {"name": name, "path": path})
        existing.add(path)
        added += 1
    print(f"Imported {added} project metadata records; no sessions or credentials were imported")


def seed():
    request = client()
    projects = request("/api/state")["projects"]
    project = next((p for p in projects if p["path"] == str(ROOT)), None)
    if project is None:
        project = request("/api/projects", {"name": "Parthenon · 平台开发", "path": str(ROOT)})
    board = request(f"/api/projects/{project['id']}/board")
    if board["rev"] != 0:
        print("Existing roadmap preserved; edit it in the workspace")
        return
    plan = json.loads((ROOT / "scripts/project-roadmap.json").read_text())
    models = {e["harness"]: e["model"] for e in request("/api/workflow/executors")}
    for stage in plan["stages"]:
        for role in ("primary", "secondary"):
            assignment = stage[role]
            assignment["model"] = models.get(assignment["harness"]) or assignment["model"]
    plan.update(projectId=project["id"], rev=0)
    request(f"/api/projects/{project['id']}/board", plan, "PUT")
    request(f"/api/projects/{project['id']}/capabilities", {"name": "parthenon-project-manager", "kind": "skill", "content": (ROOT / "skills/parthenon-project-manager/SKILL.md").read_text()})
    print(f"Roadmap and project-manager skill draft created: {BASE}/projects?project={project['id']}")


def caddy_request(path, payload=None, method="GET", etag=None):
    headers = {"Content-Type": "application/json"}
    if etag:
        headers["If-Match"] = etag
    req = urllib.request.Request(CADDY + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=5) as response:
        body = response.read(4 << 20)
        return (json.loads(body) if body else None), response.headers.get("ETag")


def development_route():
    # Preserve the prefix all the way to the backend. Authentication is the
    # development database's own account; production's basic-auth is untouched.
    return {
        "@id": ROUTE_ID,
        "match": [{"host": ["parthenon.atombit.top"], "path": ["/dev", "/dev/*"]}],
        "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": f"127.0.0.1:{PORT}"}]}],
        "terminal": True,
    }


def reconcile_route(enabled):
    # Each write changes exactly one route, using Caddy's ETag transaction.
    # Never POST a full config: another service also maintains live routes.
    desired = development_route()
    for attempt in range(3):
        routes, etag = caddy_request(ROUTES)
        if not isinstance(routes, list) or not etag:
            raise RuntimeError("Caddy did not provide a route array and ETag; nothing changed")
        indices = [i for i, route in enumerate(routes) if route.get("@id") == ROUTE_ID]
        if len(indices) > 1:
            raise RuntimeError("Duplicate development route IDs; refusing an ambiguous update")
        if not indices and not enabled:
            return False
        if indices and enabled and routes[indices[0]] == desired:
            return False
        index = indices[0] if indices else 0
        method = "PATCH" if indices and enabled else "PUT" if enabled else "DELETE"
        try:
            caddy_request(f"{ROUTES}/{index}", desired if enabled else None, method, etag)
            return True
        except urllib.error.HTTPError as error:
            if error.code != 412 or attempt == 2:
                raise RuntimeError(f"Caddy route update refused (HTTP {error.code}); no broad reload attempted") from None
    return False


def publication_enabled():
    return PUBLICATION.exists() and json.loads(PUBLICATION.read_text()).get("enabled") is True


def cron_text():
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    if result.returncode and "no crontab" not in result.stderr.lower():
        raise RuntimeError("Cannot read the user's crontab")
    return result.stdout if result.returncode == 0 else ""


def update_cron(enabled):
    before = cron_text()
    retained = "".join(line for line in before.splitlines(keepends=True) if not line.rstrip().endswith(CRON_MARKER))
    if enabled:
        log = DATA / "watchdog.log"
        log.touch(mode=0o600, exist_ok=True)
        log.chmod(0o600)
        command = "/usr/bin/env PATH=" + shlex.quote(str(Path.home() / ".local/bin") + ":/usr/local/bin:/usr/bin:/bin") + " /usr/bin/python3 -B " + shlex.quote(str(ROOT / "scripts/panel-dev.py")) + " ensure-published >> " + shlex.quote(str(log)) + " 2>&1 " + CRON_MARKER
        if retained and not retained.endswith("\n"):
            retained += "\n"
        retained += "@reboot " + command + "\n* * * * * " + command + "\n"
    if retained == before:
        return
    if cron_text() != before:
        raise RuntimeError("Crontab changed concurrently; retry without overwriting it")
    subprocess.run(["crontab", "-"], input=retained, text=True, check=True)


def healthy():
    with urllib.request.urlopen(BASE + "/api/auth/state", timeout=5) as response:
        if response.status != 200 or json.load(response).get("configured") is not True:
            raise RuntimeError("Development instance is not ready with its own account")


def publish():
    if not running():
        raise RuntimeError("Start and verify the development instance before publishing it")
    healthy()
    # The backup may contain auth hashes. It is private runtime state, never Git.
    config, _ = caddy_request("/config/")
    private_json(DATA / ("caddy-before-publish-" + time.strftime("%Y%m%d-%H%M%S") + ".json"), config)
    reconcile_route(True)
    private_json(PUBLICATION, {"enabled": True, "url": PUBLIC, "basePath": BASE_PATH})
    try:
        update_cron(True)
    except Exception:
        private_json(PUBLICATION, {"enabled": False, "url": PUBLIC})
        reconcile_route(False)
        raise
    print(f"Published {PUBLIC}; only its route is managed, with reboot and minute recovery")


def unpublish():
    private_json(PUBLICATION, {"enabled": False, "url": PUBLIC})
    update_cron(False)
    reconcile_route(False)
    print("Development route withdrawn; all other Caddy routes and cron entries preserved")


def ensure_published():
    if not publication_enabled():
        return
    if not running():
        # A watchdog may restore only the installed release, never an untested
        # binary somebody is building in the working tree.
        start(refresh_binary=False)
    healthy()
    if reconcile_route(True):
        print(f"Restored the development route at {time.strftime('%Y-%m-%d %H:%M:%S')}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["start", "stop", "restart", "status", "publish", "unpublish", "ensure-published", "import-projects", "seed"])
    parser.add_argument("--source", type=Path, help="Read-only source database for project metadata import")
    args = parser.parse_args()
    DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(DATA, 0o700)
    with open(DATA / "control.lock", "a", opener=lambda p, f: os.open(p, f, 0o600)) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == "start": start()
        elif args.command == "stop":
            if publication_enabled(): unpublish()
            stop_process()
        elif args.command == "restart":
            stop_process()
            start()
        elif args.command == "status": print(f"{'running' if running() else 'stopped'} · {BASE}/projects · publication {'enabled' if publication_enabled() else 'disabled'}")
        elif args.command == "publish": publish()
        elif args.command == "unpublish": unpublish()
        elif args.command == "ensure-published": ensure_published()
        elif args.command == "seed": seed()
        elif args.command == "import-projects":
            if not args.source: parser.error("import-projects requires --source")
            import_projects(args.source)


if __name__ == "__main__":
    main()
