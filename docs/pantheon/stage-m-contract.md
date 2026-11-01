# Stage M: members behind one front door

A second person gets a Pantheon of their own on the same address as the
owner's, `parthenon.atombit.top`, with a login and nothing else in common: not
the projects, not the terminals, not the Linux account. The owner can look at a
member's projects. This contract says how, and what may not be added to it.

## 1. Why a member is a Linux account and an instance, not a row in `users`

A session's terminal runs as its panel's Linux user. A second row in the
owner's `users` table is a shell as `cyx`: `/home/cyx`, `~/.claude`'s
credentials, the database and `secrets.key`, whatever the interface hides.
So the boundary is the Linux account. Each member has:

- a Linux user, home `0700`, password locked (the panel is the way in);
- a panel instance, `vibepanel-<name>.service`, the same binary as production,
  running as that user, listening on its own loopback port;
- a sessions scope, `vibepanel-sessions-<uid>.scope`, with its own `MemoryMax`
  and `IPAddressDeny=127.0.0.1/32 ::1/128`. 127.0.0.1 is where Caddy's
  unauthenticated admin API and the owner's panels listen. The member's panel
  listens on another loopback address (127.0.0.2 and up), so its own hooks
  still report.

Nothing in the instance is new code. `service prepare --as <user>` and the
uid in `ScopeName` already exist for this.

## 2. The front door

The owner's production panel is the only thing on the public address. It is
the **gateway**: it serves the interface, checks every login, and for a
member's requests it is a reverse proxy to that member's instance.

```
browser ──► Caddy (basic auth) ──► owner's panel (gateway, 127.0.0.1:18443)
                                     ├─ owner's cookie  → owner's routes, as today
                                     └─ member's cookie → /api/*, /ws only
                                                           ──► member instance
                                                               (127.0.0.2:18450),
                                                               as that member
```

### 2.1 Same origin is the danger, so the member never serves a document

A member's instance is code the member controls: they run as its Linux user,
and can replace the process. On the same origin as the owner's panel, a
document or a script from that instance would run with the owner's cookie in
reach and could call every owner route. So:

- **Documents, scripts, styles, the service worker and everything outside
  `/api/` and `/ws` are always the gateway's own embedded files**, whoever is
  signed in. The member's instance is never asked for them.
- What a member's instance returns is passed to the browser only as **API
  data**, with the gateway forcing the response's security headers:
  `Content-Type` must be `application/json`, `text/plain` or
  `application/octet-stream` (anything else becomes `application/octet-stream`),
  plus `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` on
  anything that is not JSON, and the gateway's own CSP. A file the member's
  project holds can be downloaded; it cannot become a page on this origin.
- The interface already renders file previews and markdown. Rendering is done
  by the gateway's bundle, which is the owner's code. HTML from a file is
  rendered inside the existing sandboxed preview, which has no access to the
  origin.
- Routes that serve HTML or run a page's code are **refused for members** at
  the gateway: share pages (`/share/*`, `/api/share/*`), admin pages
  (`/page-admin/*`, `/api/page-admin/*`, `/pages/*/admin/`), plugin frames,
  themes and code, previews. They can be added later, each on an origin of
  its own, never here.

### 2.2 Accounts

- **Migration 043-members** adds one table, `members`: `id`, `username`
  (unique across `users` and `members`), `password_hash` (argon2id, as
  `users`), `linux_user`, `upstream` (`127.0.0.N:port`, loopback only),
  `disabled`, `created_at`. It adds `member_sessions` too, the twin of
  `auth_sessions`. `currentUser` does not read either table (red line 8's
  shape): a member's cookie is an unknown string to every owner route, which
  answers 401.
- **Login** looks the name up in `users` first, then in `members`. One form,
  one throttle, one dummy verify for unknown names. A member login sets a
  member cookie. The cookie has a distinct name and the same attributes
  (`HttpOnly`, `SameSite=Strict`, `Secure` behind TLS).
- **The gateway authenticates to the member's instance** with a bearer token
  that it mints there. The instance's API tokens are the ordinary mechanism.
  The token is sealed in the owner's database with `secrets.key`. The member's
  browser never sees it.
- **Cross-origin writes** are refused for member requests by the same
  `crossOriginWrite` check, before anything is proxied.
- The member changes their own password at the gateway. It is the gateway's
  credential, not the instance's.

### 2.3 What is proxied

For a member's cookie:

| Path | Gateway does |
|---|---|
| `/api/auth/*`, `/api/health` | answers itself: sign-in state, sign-out, password change |
| `/api/*` except the refused list in §2.1 | proxy to the member's instance with its bearer, headers forced as in §2.1 |
| `/ws` | proxy the WebSocket after the handshake's Origin check; re-check the member session on the same schedule as `stillAuthorized` |
| everything else | the gateway's embedded interface |

`X-Forwarded-For` is set to the client address the gateway computed, and the
instance trusts it only from the gateway (`VIBEPANEL_TRUSTED_PROXIES`), so
its own throttle and audit log record the real address.

A member instance that is down answers 502 with a sentence saying whose
instance and that the owner can restart it. It is never a fallback to the
owner's panel.

### 2.4 The owner looking at a member

On the owner's panel, *Members* lists each member with a health dot and a
link. Opening one shows that member's projects and home page **rendered by
the owner's interface**, from data the owner's panel reads server-side with
the member instance's token: `GET /api/members/{id}/home` and the read routes
under it. It is **read-only** in this stage. To act in a member's sessions,
the owner signs in as the member, which the audit log records as the member.

No owner route proxies arbitrary paths to a member. Each read is a named route
with a fixed upstream path, so the list of what the owner can see of a member
is in one file and pinned by a test.

### 2.5 Granting an agent login

A member's Claude and Codex logins live in the member's home, set up by the
member in their own terminal. The owner may grant a Claude subscription. The
grant is a `claude setup-token` token in a root-owned environment file that
the member's unit reads (`/etc/vibepanel-members/<name>/grants.env`). It is
never a copy of the owner's `.credentials.json`: two copies of one refresh
token rotate each other away, and the loser can be the owner's production
sessions.

## 3. Provisioning

`vibepanel member add <name>` (root):

1. the Linux user and home; copies of the owner's `claude`/`codex` npm
   installs with an `.npmrc` prefix of their own;
2. `/etc/vibepanel-members/<name>/panel.env` (root's, because the unit's root
   `ExecStartPre` reads it): the loopback address, the gateway as the only
   trusted proxy;
3. the instance's database: one account named after the member with a random
   password nobody uses (the gateway signs in with its token), the gateway's
   API token, and the resource policy at the member's share;
4. the scope drop-in, the unit, started and checked;
5. a row in the gateway's `members` with the password the owner chose.

`member grant-claude`, `member revoke-claude`, `member disable` (refuses the
login, stops the unit, keeps everything) and `member remove`, which deletes
only after a separate confirmation.

A deploy restarts every member unit after the owner's, because they share the
binary.

## 4. What must be true, as tests

- `TestAMemberCookieIsUnknownToEveryOwnerRoute`: walk the router; every owner
  route answers 401 to a member cookie and to the member's bearer.
- `TestAMemberIsNeverServedADocumentFromTheirInstance`: with a fake instance
  that returns HTML with a script, every proxied path comes back with a
  non-HTML type and `nosniff`. Every non-API path comes back as the gateway's
  own file, with the fake instance never contacted.
- `TestTheRefusedRoutesAreRefusedForMembers`: the §2.1 list, each 404 for a
  member.
- `TestAMemberRequestNeverReachesAnotherMember`: two fake instances; each
  member's requests land on their own.
- `TestOwnerReadsOfAMemberAreTheseRoutes`: the list in §2.4.
- `TestMemberLoginSharesTheThrottle`: alternating wrong passwords for an owner
  name and a member name are throttled together.
- The browser check `member-check`: sign in as a member, see only their
  projects, open a terminal, type into it; then the owner opens Members and
  sees the same projects; then a page served by the fake instance's file
  route does not execute.

## 5. Rollback

Migration 043 adds two tables and changes no existing row. pantheon.14 and
earlier refuse a database newer than they know, so a rollback restores the
pre-deploy snapshot with the binary, as the S3 release did. Member units are
stopped first. Their instances' own databases are untouched by the gateway's
rollback.

## 6. Not in this stage

Roles beyond owner and member, sharing a single project, quotas beyond the
scope's memory, per-member remote servers, and the owner acting inside a
member's session from the owner's own login. Each is a later decision, and
§2.1 applies to all of them: nothing a member controls is ever served as a
document on this origin.
