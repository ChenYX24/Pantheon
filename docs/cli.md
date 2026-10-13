# The command line

`vibepanel` is the panel's binary, and with a subcommand it is the panel's
command line: everything the sidebar and the settings page can do, from a
shell, for a panel in a container where there is no browser at hand.
`vibepanel --help` lists the commands; each has its own `--help`.

## How it reaches the panel

A command that changes what the panel shows -- a rename, a restart, text
typed into a session -- goes through the running panel's own API, so it is
the same handler the browser uses: audited, pushed to every open tab, tmux
asked by the process that owns it. The address is the one the panel wrote
into `<data dir>/panel.url` when it started (and removes when it stops),
so the CLI reaches the panel that owns its data directory and never another
one on the default port; `VIBEPANEL_CLI_URL` names one across a wire.

The credential is an API token named `cli`. The CLI mints it itself on
first use, into the panel's token table -- it runs as the panel's user with
the database in reach, so this is a default and not a boundary -- and
keeps it in `<data dir>/cli.token`, mode 0600. It is on the settings page's
token list like any other; revoking it there (or `vibepanel token revoke
cli`) locks the shell out until the next command mints a new one, which the
activity log records. `VIBEPANEL_CLI_TOKEN` supplies a token instead, for a
panel across a wire.

Without a running panel -- or before the first account exists, when there
is nothing to mint a token for -- the subcommands that existed before the
panel could be asked (`project ls|add|archive|restore|rm`, `session
ls|new|kill`) work on the database and tmux directly and say so on stderr.
The rest say the panel is not running.

## Naming things

A project is named by its id, its exact name, an unambiguous start of its
name, or its directory. A session by its id, its exact title, or an
unambiguous start of its title. A name that fits two things is an error
that lists both rather than a guess. Flags may come after the thing they
qualify: `project add ~/work/api --name API`.

`--json` on the listing commands prints the panel's answer as it came, for
scripts.

## The commands

| | |
|---|---|
| `status` | the projects and sessions as the sidebar shows them: state (● working ▲ waiting ✓ done ○ none), title, live, frozen, pinned |
| `project ls` | projects, with their session counts, then the archived ones |
| `project add <dir> [--name N]` | register a directory (an archived project at that directory comes back instead) |
| `project rename <p> <name>` | |
| `project pin\|unpin <p>` | |
| `project order <p> <p> … \| --auto` | a manual order for the ones named, the rest after them; `--auto` is by activity again |
| `project archive\|restore\|rm <p>` | `rm` kills the project's sessions first |
| `session ls` | every session with its state, grouped by project |
| `session new --project <p> [--title T] [--cols N --rows N] [-- cmd…]` | a session; no command runs the project's default |
| `session rename <s> <title>` | the title is then manual: the next poll does not overwrite it |
| `session pin\|unpin <s>` | |
| `session state <s> working\|waiting\|done` | set the state by hand |
| `session restart <s>` | the same command again in a new session |
| `session kill <s>` | |
| `session send <s> [text] [--enter]` | type into it; with no text, stdin; `--enter` presses Enter after |
| `session screen <s>` | the pane as text |
| `session restore` | rebuild the sessions a reboot took |
| `note get\|set <p> [text]` | the project's note; `set` with no text reads stdin |
| `todo ls\|add\|done\|undo\|rm <p> [text\|id]` | the project's todos; `done`, `undo` and `rm` take an id or the start of the text |
| `token ls\|create <name>\|revoke <id\|name>` | API tokens; `create` prints the token once |
| `audit [-n 50]` | the activity log, oldest first |
| `settings archive-idle <days>` | archive a project idle that long; 0 never |
| `settings timezone <zone>` | |
| `page …`, `plugin …`, `account …`, `service …`, `hook …`, `tune …`, `doctor` | as before: share pages, plugins, the first account, the service, the agent hooks, another tool's settings, a health check |

## In a container

The panel's image runs `vibepanel serve` as its one process; `docker exec
<container> vibepanel status` is the panel from the outside, and every
command above works the same way, because the CLI finds the panel at its
own loopback address inside the container and the token file under the
data volume survives a restart of the container.
