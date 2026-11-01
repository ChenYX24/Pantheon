#!/usr/bin/env bash
# pantheon-member: a second person's own panel, behind the owner's front door.
#
# docs/pantheon/stage-m-contract.md is the design. In short: a member is a
# Linux account with a panel instance of their own; the owner's panel is the
# only thing on the public address, signs the member in, and proxies their
# API and terminals to that instance. Nothing here touches DNS.
#
# Installed as /usr/local/sbin/pantheon-member, run as root:
#
#   pantheon-member add <name>            create or bring up to date; the
#                                         sign-in password is read from stdin
#                                         (or asked for twice on a terminal)
#   pantheon-member grant-claude <name>   a Claude subscription for their new
#                                         sessions: paste a `claude setup-token`
#   pantheon-member revoke-claude <name>
#   pantheon-member restart-all           after a deploy: members share the binary
#   pantheon-member list
#   pantheon-member remove <name>         unregister and stop; keeps the Linux
#                                         account, its home and its data
#
# The gateway is production unless PANTHEON_GATEWAY / PANTHEON_GATEWAY_TOKEN
# say otherwise (a /dev trial: PANTHEON_GATEWAY=http://127.0.0.1:19444/dev,
# PANTHEON_CADDY_HOST= to leave Caddy alone).
#
# Passwords and tokens never go on a command line, where every account on the
# machine can read them in the process list: they go through stdin and
# root-only files.
set -euo pipefail

OWNER=${PANTHEON_OWNER:-cyx}
GATEWAY=${PANTHEON_GATEWAY:-http://127.0.0.1:18443}
GATEWAY_TOKEN_FILE=${PANTHEON_GATEWAY_TOKEN:-/home/$OWNER/.local/share/vibepanel/cli.token}
# The host whose Caddy route has basic auth in front of the gateway. A member
# has to get through it too. Empty leaves Caddy alone.
CADDY_HOST=${PANTHEON_CADDY_HOST-parthenon.atombit.top}
SESSIONS_MEM=${PANTHEON_MEMBER_MEM:-1G}
PANEL_MEM=400M
# Their panel's own budget, as a share of the machine. 30 is the lowest the
# panel accepts (resources.MinPoolPercent), a little over the scope's 1 GiB
# on 3.5: the scope is the ceiling, and this is what their page shows.
POOL_PERCENT=${PANTHEON_MEMBER_POOL:-30}
PORT=18450
BIN=/usr/local/bin/vibepanel
ETC=/etc/vibepanel-members
OWNER_NODE=/home/$OWNER/.local/lib/node_modules
CADDY=http://localhost:2019

fail() { printf 'pantheon-member: %s\n' "$*" >&2; exit 1; }
ok() { printf '[ ok ] %s\n' "$*"; }
need_root() { [[ $EUID -eq 0 ]] || fail "run as root (sudo pantheon-member $*)"; }
valid_name() { [[ $1 =~ ^[a-z][a-z0-9_-]{1,30}$ ]] || fail "a member name is lowercase letters, digits, - and _: $1"; }

TMPD=$(mktemp -d /tmp/pantheon-member.XXXXXX)
chmod 700 "$TMPD"
trap 'rm -rf "$TMPD"' EXIT

# A bearer as a curl header file, so the token is not in argv.
bearer() { local f; f=$(mktemp "$TMPD/h.XXXXXX"); printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$1")" > "$f"; echo "$f"; }
gw() { # method path [json-file]
  local h; h=$(bearer "$GATEWAY_TOKEN_FILE")
  curl -sS --max-time 20 -X "$1" -H "@$h" -H 'Content-Type: application/json' ${3:+--data "@$3"} -w '\n%{http_code}' "$GATEWAY$2"
}
inst() { # name method path [json-file]
  local h; h=$(bearer "$(datadir "$1")/cli.token")
  curl -sS --max-time 20 -X "$2" -H "@$h" -H 'Content-Type: application/json' ${4:+--data "@$4"} -w '\n%{http_code}' "http://$(upstream "$1")$3"
}
status_of() { tail -n1 <<<"$1"; }
body_of() { sed '$d' <<<"$1"; }
json_get() { python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {"d": d}))' "$1"; }

home_of() { getent passwd "$1" | cut -d: -f6; }
datadir() { echo "$(home_of "$1")/.local/share/vibepanel"; }
upstream() { sed -n 's/^VIBEPANEL_ADDR=//p' "$ETC/$1/panel.env"; }
unit() { echo "vibepanel-$1.service"; }
scope() { echo "vibepanel-sessions-$(id -u "$1").scope"; }
as_member() { local n=$1; shift; runuser -u "$n" -- env -i HOME="$(home_of "$n")" USER="$n" LOGNAME="$n" PATH="$(home_of "$n")/.local/bin:/usr/local/bin:/usr/bin:/bin" "$@"; }
listening_on() { # ip port
  python3 -I - "$1" "$2" <<'PY'
import socket, sys
s = socket.socket(); s.settimeout(0.5)
sys.exit(0 if s.connect_ex((sys.argv[1], int(sys.argv[2]))) == 0 else 1)
PY
}

registered_id() { # name -> id or ''
  local res; res=$(gw GET /api/members)
  [[ $(status_of "$res") == 200 ]] || fail "the gateway at $GATEWAY did not list members: $(body_of "$res")"
  body_of "$res" | json_get "next((m['id'] for m in d['members'] if m['username'] == '$1'), '')"
}

read_password() {
  local p q
  if [[ -t 0 ]]; then
    read -rsp "Sign-in password for $1 (12+ characters): " p; echo >&2
    read -rsp 'Again: ' q; echo >&2
    [[ $p == "$q" ]] || fail 'the two passwords differ'
  else
    IFS= read -r p || true
  fi
  [[ ${#p} -ge 12 ]] || fail 'the password is shorter than the panel accepts (12)'
  printf '%s' "$p"
}

# ─── Caddy: the member through the basic auth in front of the gateway ───────

# The path, in Caddy's config API, of the accounts list that guards the
# gateway on $CADDY_HOST. Found by walking, not by index: the routes include
# another service's, and their order is not this script's.
caddy_accounts_path() {
  # Through a file: `python3 - <<HEREDOC` makes the heredoc the program, so
  # the routes cannot also arrive on stdin.
  local routes; routes=$(mktemp "$TMPD/routes.XXXXXX")
  curl -fsS "$CADDY/config/apps/http/servers/srv0/routes" > "$routes"
  python3 -I - "$CADDY_HOST" "$GATEWAY" "$routes" <<'PY'
import json, sys
from urllib.parse import urlparse
host, gw = sys.argv[1], urlparse(sys.argv[2])
routes = json.load(open(sys.argv[3]))
dial = f"{gw.hostname}:{gw.port}"
found = []
def walk(node, path, auth):
    if isinstance(node, dict):
        if node.get("handler") == "authentication":
            auth = path + "/providers/http_basic/accounts"
        if node.get("handler") == "reverse_proxy" and any(u.get("dial") == dial for u in node.get("upstreams", [])) and auth:
            found.append(auth)
        for k, v in node.items():
            walk(v, f"{path}/{k}", auth)
    elif isinstance(node, list):
        # An authentication handler guards the handlers after it in the same list.
        guard = auth
        for i, v in enumerate(node):
            if isinstance(v, dict) and v.get("handler") == "authentication":
                guard = f"{path}/{i}/providers/http_basic/accounts"
            walk(v, f"{path}/{i}", guard)
for i, r in enumerate(routes):
    hosts = [h for m in r.get("match", []) for h in m.get("host", [])]
    if host in hosts:
        walk(r, f"/config/apps/http/servers/srv0/routes/{i}", None)
found = sorted(set(found))
print(found[0] if len(found) == 1 else "")
PY
}

caddy_add_account() { # name, password on stdin of the caller via file
  [[ -n $CADDY_HOST ]] || return 0
  local path; path=$(caddy_accounts_path)
  [[ -n $path ]] || fail "no single basic-auth guard found for $CADDY_HOST in front of $GATEWAY; Caddy left alone"
  if curl -fsS "$CADDY$path" | python3 -I -c 'import json,sys; sys.exit(0 if any(a.get("username")==sys.argv[1] for a in json.load(sys.stdin)) else 1)' "$1"; then
    ok "Caddy basic auth already admits $1"; return 0
  fi
  local hash etag f
  hash=$(caddy hash-password < "$2")
  f=$(mktemp "$TMPD/acct.XXXXXX")
  python3 -I -c 'import json,sys; print(json.dumps({"username": sys.argv[1], "password": sys.argv[2]}))' "$1" "$hash" > "$f"
  etag=$(curl -s -D - -o /dev/null "$CADDY$path" | awk -F': ' 'tolower($1)=="etag"{sub(/\r$/,"",$2); print $2}')
  curl -fsS -X POST -H 'Content-Type: application/json' -H "If-Match: $etag" --data "@$f" "$CADDY$path" >/dev/null \
    || fail 'Caddy refused the account (the config changed meanwhile?); run add again'
  ok "Caddy basic auth on $CADDY_HOST admits $1"
}

caddy_remove_account() {
  [[ -n $CADDY_HOST ]] || return 0
  local path i etag; path=$(caddy_accounts_path)
  [[ -n $path ]] || return 0
  i=$(curl -fsS "$CADDY$path" | python3 -I -c 'import json,sys; a=json.load(sys.stdin); print(next((i for i,x in enumerate(a) if x.get("username")==sys.argv[1]), ""))' "$1")
  [[ -n $i ]] || return 0
  [[ $(curl -fsS "$CADDY$path" | python3 -I -c 'import json,sys; print(len(json.load(sys.stdin)))') -gt 1 ]] || fail 'refusing to remove the last basic-auth account'
  etag=$(curl -s -D - -o /dev/null "$CADDY$path" | awk -F': ' 'tolower($1)=="etag"{sub(/\r$/,"",$2); print $2}')
  curl -fsS -X DELETE -H "If-Match: $etag" "$CADDY$path/$i" >/dev/null || fail 'Caddy refused the removal; run remove again'
  ok "Caddy basic auth no longer admits $1"
}

# ─── add ────────────────────────────────────────────────────────────────────

add() {
  local name=$1; need_root add "$name"; valid_name "$name"
  [[ $name != "$OWNER" ]] || fail 'that is the owner'
  [[ -r $GATEWAY_TOKEN_FILE ]] || fail "no gateway token at $GATEWAY_TOKEN_FILE"
  local pwfile; pwfile=$(mktemp "$TMPD/pw.XXXXXX"); read_password "$name" > "$pwfile"

  # 1. The account. Locked password: the panel is the way in.
  if ! id "$name" >/dev/null 2>&1; then
    useradd --create-home --user-group --shell /bin/bash --comment 'Pantheon member' "$name"
    passwd -l "$name" >/dev/null
  fi
  local home; home=$(home_of "$name")
  chmod 0700 "$home"
  ok "user $name (uid $(id -u "$name")), home 0700, password locked"

  # 2. The agents: copies of the owner's npm installs, so both start on a
  # version that has been used here; later updates are theirs (.npmrc).
  local pkg
  for pkg in @anthropic-ai/claude-code @openai/codex; do
    [[ -d $OWNER_NODE/$pkg ]] || fail "no $pkg under $OWNER_NODE to copy"
    if [[ ! -d $home/.local/lib/node_modules/$pkg ]]; then
      install -d -o "$name" -g "$name" "$home/.local" "$home/.local/lib" "$home/.local/lib/node_modules" "$home/.local/lib/node_modules/${pkg%/*}" "$home/.local/bin"
      cp -a "$OWNER_NODE/$pkg" "$home/.local/lib/node_modules/$pkg"
      chown -R "$name:$name" "$home/.local/lib/node_modules/${pkg%/*}"
    fi
  done
  as_member "$name" ln -sfn ../lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe "$home/.local/bin/claude"
  as_member "$name" ln -sfn ../lib/node_modules/@openai/codex/bin/codex.js "$home/.local/bin/codex"
  [[ -e $home/.npmrc ]] || as_member "$name" sh -c "printf 'prefix=%s\n' '$home/.local' > '$home/.npmrc'"
  as_member "$name" claude --version >/dev/null && as_member "$name" codex --version >/dev/null || fail 'claude or codex does not run as the member'
  ok "claude $(as_member "$name" claude --version | head -1), $(as_member "$name" codex --version | head -1)"

  # 3. Configuration, root's: the unit's root ExecStartPre reads it.
  install -d -m 0700 -o root -g root "$ETC" "$ETC/$name"
  if [[ ! -f $ETC/$name/panel.env ]]; then
    local n addr=''
    for n in $(seq 2 250); do
      grep -qsx "VIBEPANEL_ADDR=127.0.0.$n:$PORT" "$ETC"/*/panel.env && continue
      listening_on "127.0.0.$n" "$PORT" && continue
      addr=127.0.0.$n:$PORT; break
    done
    [[ -n $addr ]] || fail 'no free loopback address'
    cat > "$ETC/$name/panel.env" <<EOF
# vibepanel for $name, behind the gateway at $GATEWAY. Written by pantheon-member.
# Loopback only, and trusting X-Forwarded-For from the gateway alone.
VIBEPANEL_ADDR=$addr
VIBEPANEL_TRUSTED_PROXIES=127.0.0.1/32
EOF
    chmod 0600 "$ETC/$name/panel.env"
  fi
  [[ -f $ETC/$name/grants.env ]] || { printf '# What the owner granted %s.\n' "$name" > "$ETC/$name/grants.env"; chmod 0600 "$ETC/$name/grants.env"; }
  local up; up=$(upstream "$name")
  ok "config in $ETC/$name, panel on $up"

  # 4. The instance's own account: a random password nobody types. The member
  # signs in at the gateway; the gateway signs in here with a token.
  local data; data=$(datadir "$name")
  local users=0
  [[ -f $data/vibepanel.db ]] && users=$(as_member "$name" python3 -I -c "import sqlite3,sys; print(sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True).execute('SELECT COUNT(*) FROM users').fetchone()[0])" "$data/vibepanel.db")
  if [[ $users == 0 ]]; then
    head -c 32 /dev/urandom | base64 | tr -d '\n' | as_member "$name" "$BIN" account create --username "$name" --password-stdin >/dev/null
  fi
  ok "instance account"

  # 5. The sessions' scope: written before it exists, checked after.
  local sc; sc=$(scope "$name")
  install -d -m 0755 "/etc/systemd/system/$sc.d"
  cat > "/etc/systemd/system/$sc.d/50-member.conf" <<EOF
# pantheon-member: $name's sessions. A ceiling of their own, beside the owner's.
# IPAddressDeny: 127.0.0.1 is Caddy's admin API, which has no authentication,
# and the owner's panels. Their own panel is on ${up%%:*}.
[Scope]
MemoryMax=$SESSIONS_MEM
MemorySwapMax=0
CPUWeight=100
IPAddressDeny=127.0.0.1/32 ::1/128
EOF

  # 6. The unit: the production unit's shape, a ceiling of its own (red line 9:
  # never the sessions' cgroup), and less CPU and IO weight than the owner's.
  cat > "/etc/systemd/system/$(unit "$name")" <<EOF
[Unit]
Description=vibepanel for $name (Pantheon member)
After=network-online.target vibepanel.service
Wants=network-online.target

[Service]
Type=exec
User=$name
Environment=HOME=$home
Environment="PATH=$home/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
EnvironmentFile=$ETC/$name/panel.env
EnvironmentFile=-$ETC/$name/grants.env
ExecStartPre=-+$BIN service prepare --as $name
Environment=VIBEPANEL_SESSIONS_PREPARED=1
ExecStart=$BIN serve
WorkingDirectory=$home
Restart=always
RestartSec=3
SuccessExitStatus=143
TimeoutStopSec=20
KillMode=process
CPUWeight=100
IOWeight=100
MemoryAccounting=yes
MemoryMax=$PANEL_MEM
MemorySwapMax=0
OOMPolicy=continue

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --quiet "$(unit "$name")"
  systemctl restart "$(unit "$name")"
  local i; for i in {1..30}; do curl -fsS --max-time 2 "http://$up/api/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS --max-time 2 "http://$up/api/health" >/dev/null || { journalctl -u "$(unit "$name")" -n 30 --no-pager >&2; fail "$(unit "$name") did not become healthy"; }
  ok "$(unit "$name") healthy"

  local max deny
  max=$(systemctl show "$sc" -p MemoryMax --value); deny=$(systemctl show "$sc" -p IPAddressDeny --value)
  if [[ $deny != *127.0.0.1* ]]; then
    systemctl set-property "$sc" MemoryMax="$SESSIONS_MEM" MemorySwapMax=0 CPUWeight=100 IPAddressDeny='127.0.0.1/32 ::1/128'
    max=$(systemctl show "$sc" -p MemoryMax --value); deny=$(systemctl show "$sc" -p IPAddressDeny --value)
  fi
  [[ $deny == *127.0.0.1* && $max != infinity ]] || fail "$sc has MemoryMax=$max IPAddressDeny=$deny"
  ok "$sc: MemoryMax=$max, IPAddressDeny=$deny"

  # 7. A token for the gateway, minted through the instance's own API with the
  # member's CLI token (which `project ls` mints the first time).
  as_member "$name" "$BIN" project ls >/dev/null
  [[ -f $data/cli.token ]] || fail "the instance's CLI token was not minted"
  local f res token
  # Files, not variables passed as arguments: see the header.
  f=$(mktemp "$TMPD/j.XXXXXX"); printf '{"mode":"custom","poolPercent":%d}' "$POOL_PERCENT" > "$f"
  res=$(inst "$name" PUT /api/resources/policy "$f")
  [[ $(status_of "$res") == 200 ]] && ok "their resource pool: $POOL_PERCENT% of the machine" || echo "note: their resource policy answered $(status_of "$res"); the scope's $SESSIONS_MEM still holds" >&2

  local id; id=$(registered_id "$name")
  if [[ -z $id ]]; then
    printf '{"name":"pantheon gateway"}' > "$f"
    res=$(inst "$name" POST /api/settings/tokens "$f")
    [[ $(status_of "$res") == 201 || $(status_of "$res") == 200 ]] || fail "minting the gateway token: $(body_of "$res")"
    token=$(mktemp "$TMPD/t.XXXXXX")
    body_of "$res" | json_get "d['token']" > "$token"
    python3 -I -c 'import json,sys; print(json.dumps({"username":sys.argv[1],"password":open(sys.argv[2]).read(),"linuxUser":sys.argv[1],"upstream":sys.argv[3],"token":open(sys.argv[4]).read().strip()}))' \
      "$name" "$pwfile" "$up" "$token" > "$f"
    res=$(gw POST /api/members "$f")
    [[ $(status_of "$res") == 201 ]] || fail "the gateway refused the member: $(body_of "$res")"
    ok "registered at the gateway"
  else
    python3 -I -c 'import json,sys; print(json.dumps({"password":open(sys.argv[1]).read()}))' "$pwfile" > "$f"
    res=$(gw PATCH "/api/members/$id" "$f")
    [[ $(status_of "$res") == 200 ]] || fail "updating the member's password: $(body_of "$res")"
    ok "already registered; password set"
  fi
  rm -f "$f"

  # 8. Through Caddy's basic auth, with the same password.
  caddy_add_account "$name" "$pwfile"

  # 9. From inside their scope: a pane on their tmux server. Not vp_: that
  # prefix is the panel's, and it would take the probe for one of its own.
  local probe=memberprobe out
  as_member "$name" tmux -L vibepanel kill-session -t "=$probe:" 2>/dev/null || true
  as_member "$name" tmux -L vibepanel new-session -d -s "$probe" \
    "ls /home/$OWNER >/dev/null 2>&1 && echo home=READABLE || echo home=denied; curl -s -o /dev/null -m 3 http://127.0.0.1:2019/config/ && echo caddy=REACHABLE || echo caddy=blocked; curl -s -o /dev/null -m 3 http://$up/api/health && echo own=reachable || echo own=UNREACHABLE; sleep 30"
  sleep 8
  out=$(as_member "$name" tmux -L vibepanel capture-pane -p -t "=$probe:")
  as_member "$name" tmux -L vibepanel kill-session -t "=$probe:" 2>/dev/null || true
  grep -q 'home=denied' <<<"$out" || fail "from their session, /home/$OWNER is readable: $out"
  grep -q 'caddy=blocked' <<<"$out" || fail "from their session, Caddy's admin API is reachable: $out"
  grep -q 'own=reachable' <<<"$out" || fail "from their session, their own panel is unreachable: $out"
  ok "from their session: /home/$OWNER denied, Caddy admin blocked, their own panel reachable"
  echo "added $name. They sign in at the owner's address with that password."
}

grant_claude() {
  local name=$1; need_root grant-claude "$name"; valid_name "$name"
  [[ -f $ETC/$name/grants.env ]] || fail "no member $name"
  local tk
  if [[ -t 0 ]]; then read -rsp 'Claude token from `claude setup-token` (hidden): ' tk; echo >&2; else IFS= read -r tk || true; fi
  [[ $tk =~ ^sk-ant-oat[A-Za-z0-9_-]{20,}$ ]] || fail 'that is not a setup-token (sk-ant-oat…); nothing changed'
  { grep -v '^CLAUDE_CODE_OAUTH_TOKEN=' "$ETC/$name/grants.env" || true; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$tk"; } > "$ETC/$name/grants.env.new"
  chmod 0600 "$ETC/$name/grants.env.new"; mv -f "$ETC/$name/grants.env.new" "$ETC/$name/grants.env"
  # Live for sessions started from now on, through a file and never argv.
  local f; f=$(as_member "$name" mktemp)
  printf 'set-environment -g CLAUDE_CODE_OAUTH_TOKEN "%s"\n' "$tk" | as_member "$name" tee "$f" >/dev/null
  as_member "$name" tmux -L vibepanel source-file "$f" 2>/dev/null || true
  as_member "$name" rm -f "$f"
  ok "granted: $name's new sessions use this Claude subscription"
}

revoke_claude() {
  local name=$1; need_root revoke-claude "$name"; valid_name "$name"
  [[ -f $ETC/$name/grants.env ]] || fail "no member $name"
  { grep -v '^CLAUDE_CODE_OAUTH_TOKEN=' "$ETC/$name/grants.env" || true; } > "$ETC/$name/grants.env.new"
  chmod 0600 "$ETC/$name/grants.env.new"; mv -f "$ETC/$name/grants.env.new" "$ETC/$name/grants.env"
  as_member "$name" tmux -L vibepanel set-environment -gu CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true
  ok "revoked for new sessions. Running ones keep it until they end; revoke the token at claude.ai to end it everywhere."
}

restart_all() {
  need_root restart-all
  local d n
  for d in "$ETC"/*/; do
    [[ -d $d ]] || continue
    n=$(basename "$d")
    systemctl is-enabled --quiet "$(unit "$n")" 2>/dev/null || continue
    systemctl restart "$(unit "$n")"
    ok "$(unit "$n") restarted"
  done
}

list() {
  local res; res=$(gw GET /api/members)
  [[ $(status_of "$res") == 200 ]] || fail "$(body_of "$res")"
  body_of "$res" | python3 -I -c '
import json, sys
for m in json.load(sys.stdin)["members"]:
    s = "paused" if m["disabled"] else ("up " + m.get("version", "")) if m["healthy"] else "NOT ANSWERING"
    print(f"{m[\"username\"]:<16} {m[\"upstream\"]:<20} {s}")'
}

remove() {
  local name=$1; need_root remove "$name"; valid_name "$name"
  local id; id=$(registered_id "$name")
  if [[ -n $id ]]; then
    local res; res=$(gw DELETE "/api/members/$id")
    [[ $(status_of "$res") == 204 ]] || fail "the gateway refused: $(body_of "$res")"
    ok "unregistered at the gateway"
  fi
  caddy_remove_account "$name"
  systemctl disable --now --quiet "$(unit "$name")" 2>/dev/null || true
  rm -f "/etc/systemd/system/$(unit "$name")"
  if id "$name" >/dev/null 2>&1; then
    # Their sessions end here: removing a member is the one time that is meant.
    systemctl stop "$(scope "$name")" 2>/dev/null || true
    rm -rf "/etc/systemd/system/$(scope "$name").d"
  fi
  systemctl daemon-reload
  ok "$name stopped and unregistered. Kept: the Linux account, its home, $ETC/$name. To delete those too: userdel -r $name && rm -rf $ETC/$name"
}

case ${1:-} in
  add) [[ -n ${2:-} ]] || fail 'add <name>'; add "$2" ;;
  grant-claude) [[ -n ${2:-} ]] || fail 'grant-claude <name>'; grant_claude "$2" ;;
  revoke-claude) [[ -n ${2:-} ]] || fail 'revoke-claude <name>'; revoke_claude "$2" ;;
  restart-all) restart_all ;;
  list) list ;;
  remove) [[ -n ${2:-} ]] || fail 'remove <name>'; remove "$2" ;;
  *) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
