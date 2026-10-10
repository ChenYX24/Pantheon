#!/bin/bash
# Pantheon Mac link: lets the Pantheon server reach this Mac over SSH while the
# Mac is on, through a reverse tunnel the Mac opens. Nothing listens publicly:
# the tunnel binds 127.0.0.1:34122 on the server, and the server's key is only
# accepted from that tunnel. No secret is shipped in this script; it creates
# its own key and prints the public half for the server to authorise.
#
#   bash install.sh            install or repair
#   bash install.sh uninstall  remove everything this script added
set -euo pipefail

SERVER=43.159.37.245
SERVER_USER=cyx
PORT=34122
SERVER_HOSTKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINEqTrm/K5DGITlzs5kth27ufg5SnP/Vg2HZJwraegfv'
SERVER_PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM/SW6D29Gpesds/+LDHDjxMZ8FdMajczmDVAsxzeky/ pantheon-server-to-mac'
DIR="$HOME/.pantheon-link"
LABEL=top.atombit.pantheon-link
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
AUTH="$HOME/.ssh/authorized_keys"

if [ "$(uname)" != Darwin ]; then echo "This installer is for macOS." >&2; exit 1; fi

if [ "${1:-}" = uninstall ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  if [ -f "$AUTH" ]; then grep -v 'pantheon-server-to-mac' "$AUTH" > "$AUTH.tmp" || true; mv "$AUTH.tmp" "$AUTH"; chmod 600 "$AUTH"; fi
  rm -rf "$DIR"
  echo "Removed the Pantheon Mac link."
  exit 0
fi

if ! nc -z -G 2 127.0.0.1 22 2>/dev/null; then
  echo "Remote Login is off. Turn it on: System Settings → General → Sharing → Remote Login, then run this again." >&2
  exit 1
fi

mkdir -p "$DIR" "$HOME/.ssh" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR" "$HOME/.ssh"
[ -f "$DIR/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C "pantheon-mac-tunnel-$(whoami)@$(hostname -s)" -f "$DIR/id_ed25519"
echo "$SERVER $SERVER_HOSTKEY" > "$DIR/known_hosts"

# The server may log in to this Mac only through the tunnel (from 127.0.0.1).
touch "$AUTH"; chmod 600 "$AUTH"
if ! grep -q 'pantheon-server-to-mac' "$AUTH"; then
  echo "from=\"127.0.0.1,::1\",no-agent-forwarding,no-port-forwarding,no-X11-forwarding $SERVER_PUBKEY" >> "$AUTH"
fi

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/ssh</string><string>-N</string>
    <string>-i</string><string>$DIR/id_ed25519</string>
    <string>-o</string><string>IdentitiesOnly=yes</string>
    <string>-o</string><string>UserKnownHostsFile=$DIR/known_hosts</string>
    <string>-o</string><string>StrictHostKeyChecking=yes</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    <string>-o</string><string>ServerAliveInterval=30</string>
    <string>-o</string><string>ServerAliveCountMax=3</string>
    <string>-o</string><string>BatchMode=yes</string>
    <string>-R</string><string>127.0.0.1:$PORT:127.0.0.1:22</string>
    <string>$SERVER_USER@$SERVER</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>$DIR/tunnel.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "Installed. Send this ONE line to Claude (it is a public key, not a secret):"
echo
cat "$DIR/id_ed25519.pub"
echo
echo "The tunnel retries every 30 s and connects once the server accepts that key."
echo "Status: launchctl print gui/$(id -u)/$LABEL | grep state ; log: $DIR/tunnel.log"
echo "Remove: bash install.sh uninstall"
