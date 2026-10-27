#!/bin/sh
# vibepanel session state reporter.
#
# Installed once, globally, into your agent's hook configuration. It reports
# what the agent is doing so the panel does not have to guess from the byte
# stream, and forwards what the agent said so the panel can pass it on.
#
# Safe to install globally: outside a vibepanel session the environment
# variables below are absent and this exits immediately, so agents you start
# from an ordinary terminal are unaffected.
#
# Usage: vibepanel-report.sh <working|waiting|done|precompact|quota> [codex|codex-notify]
#
# `quota` is not a hook: it is Claude Code's status line command, which is the
# one place Claude Code says how much of a subscription's five-hour and
# seven-day windows are used. It prints nothing, so the status line stays
# empty, and it reports at most every 15 seconds: Claude Code runs it after
# every message, as often as three times a second while a reply streams.
#
# The second argument says which agent's hook is calling, where that changes how
# the panel reads the report: `codex-notify` is Codex's older `notify` line,
# which can only ever say "waiting". Anything after it -- Codex appends a JSON
# argument to notify -- is ignored.
#
# The hook's own document -- Claude Code, Codex, Kimi Code and zcode all pipe a
# JSON object to stdin with the event's name, the transcript path and, on Stop,
# the agent's last message -- is sent as the request body, untouched. The state
# travels in the query string so that a document the panel cannot read costs
# the message and never the state.

# Never fail, never block, never print. A hook that makes an agent wait — or
# worse, error — is far more expensive than a missed state update.
[ -n "$VIBEPANEL_SESSION_ID" ] || exit 0
[ -n "$VIBEPANEL_TOKEN" ] || exit 0
[ -n "$VIBEPANEL_URL" ] || exit 0

state="$1"
signal=""
case "$state" in
  working|waiting|done) ;;
  precompact|quota) signal="$state"; state="" ;;
  *) exit 0 ;;
esac

source=""
case "${2-}" in
  codex|codex-notify) source="$2" ;;
  # An install from before codex hooks: notify = [script, "waiting"], to which
  # Codex appends its JSON. That is the legacy line, and it says so by shape.
  \{*) source="codex-notify" ;;
esac

# Read the document only from a pipe, and only for the hooks that pipe one.
# A terminal on stdin would mean waiting for somebody to press ^D, in a hook
# whose one rule is never to wait; the legacy notify line carries its document
# in argv and inherits whatever stdin Codex had, which under `codex exec` from
# a program is a pipe that never closes. The agents that pipe a document close
# it. 256 KiB is the panel's own cap; reading past it would only be discarded.
body=""
if [ "$source" != "codex-notify" ] && [ ! -t 0 ]; then
  body=$(head -c 262144 2>/dev/null)
fi

if [ "$signal" = quota ]; then
  # Only a document with limits in it is worth a request: an API-billed login
  # never has them, and a subscription has them only after the first reply.
  case "$body" in *'"rate_limits"'*) ;; *) exit 0 ;; esac
  # The id names a file below, so it has to be the panel's kind of id.
  case "$VIBEPANEL_SESSION_ID" in *[!A-Za-z0-9]*) exit 0 ;; esac
  stamp="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/vibepanel-quota-$VIBEPANEL_SESSION_ID"
  now=$(date +%s 2>/dev/null) || exit 0
  last=$(cat "$stamp" 2>/dev/null) || last=0
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  [ $((now - last)) -ge 15 ] || exit 0
  echo "$now" >"$stamp" 2>/dev/null
fi

# --insecure is safe and necessary here: the destination is 127.0.0.1, and when
# the panel is serving TLS its certificate is issued for the public hostname,
# which a loopback address will never match.
report() {
curl --silent --show-error --insecure --max-time 2 --output /dev/null \
  --request POST "$VIBEPANEL_URL/api/hook/state?sessionId=$VIBEPANEL_SESSION_ID&state=$state&source=$source&signal=$signal" \
  --header "Authorization: Bearer $VIBEPANEL_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-binary "$body" \
  >/dev/null 2>&1
}

if [ -n "$signal" ]; then
  # Compaction cannot wait on the panel, even for curl's bounded timeout, and
  # neither can a status line: Claude Code draws nothing until it returns.
  report </dev/null >/dev/null 2>&1 &
else
  report
fi

exit 0
