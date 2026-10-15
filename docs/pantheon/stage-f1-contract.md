# Pantheon stage F1 contract — one app shell, clear navigation, visual polish

Status: frozen for task F1a (frontend only), 2026-10-11. User feedback: "各个页面的关联逻辑和
前端还是太丑". Screenshots of the current state are in
`~/.local/share/cyx-tasks/pantheon-stage-a-20261009/ui-before/` (dark/light × 1440/390).

Problems to fix (seen in those screenshots):
- No shared navigation: terminal panel (`/`), legacy workspace (`/projects`), home (`/home`),
  project page (`/home/p/<id>`), resources (`/home/resources`) each have their own header and
  back links; the user cannot tell where they are.
- Header overload: view switcher, resources link, execution dot, bell, refresh, language,
  theme, panel link and sign-out in one row; on phones it wraps into two rows.
- Project page has two stacked headers; chat starter prompts use a larger font than
  everything else; empty sections ("0 项任务", "暂无汇报", "会话 · 0", "用量：未知") make
  cards tall and noisy; inconsistent paddings, radii and font sizes; long goals dominate.

## 1. App shell (all home routes)

New `web/src/components/shell/AppShell.tsx` used by HomePage (overview, project page,
resources). The terminal panel (`App.tsx`) and `/projects` keep their own layout but get the
same nav entry points (§2).

- **Desktop (≥ 1024 px)**: left sidebar 232 px (collapsible to 56 px icon rail, remembered in
  localStorage): brand "Pantheon"; primary nav — 概览 (`/home`), 待办 (`/home?view=todo`,
  badge = to-do count), 资源 (`/home/resources`), 终端 (`/`); then "项目" section listing
  projects (pinned first, then by activity; status dot = running run / waiting session /
  blocked / idle; to-do count badge) — clicking opens `/home/p/<id>`; footer: settings menu
  (language, theme, notifications, execution switch, sign out) behind one button.
- **Tablet (768–1023 px)**: icon rail only; projects in a popover.
- **Phone (< 768 px)**: top bar with page title + one overflow menu; bottom tab bar
  概览 / 待办 / 项目 (sheet with the project list) / 资源 / 终端. The project page's own
  section tabs become a horizontally scrollable segmented control under its title, not a
  second bottom bar.
- Page header (inside content): title, one-line subtitle, and at most 2 primary actions
  on the right. Secondary actions go into an overflow menu.
- Breadcrumb on project/resource detail: `概览 / <project>` or `资源 / <resource>`.

## 2. Navigation logic

- `/projects` (legacy workspace) shows a banner "新的项目页在这里 →" linking to
  `/home/p/<id>` for the selected project; the home sidebar does not link to it.
- Terminal panel sidebar: place a house-icon "首页" / "Home" link beside the "项目"
  heading, with "Pantheon 首页" / "Pantheon home" as its accessible name and title.
  Keep the collapsed rail's house link. On phones, add an icon-only Home link before
  the project-board link in the main header so it is reachable with the drawer closed.
  Each panel project that maps to a cyx project keeps its "项目页" item.
- Every session shown in Pantheon pages links to `/?session=<id>`; every project shown in the
  terminal links back to `/home/p/<id>` when it maps.
- To-do items deep-link to the exact place (task → project tasks tab with the row expanded;
  question → reports tab with the reply box focused; session → terminal).
- Browser back/forward works for view, filters, project tabs and threads (URL is the state);
  the current behaviour is kept, only the shell is added.
- Keyboard: `g o` 概览, `g t` 待办, `g r` 资源, `g p` focuses project search; `/` focuses search.

## 3. Visual system

Use the existing tokens (`--vp-*`, Tailwind mappings) and add, in one place
(`web/src/components/shell/shell.css` or tokens in styles.css):
- Type scale: page title 20/28 semibold; section title 15/22 semibold; body 14/20; meta 12/16.
  No other sizes on home pages (remove the oversized starter prompt text).
- Spacing: 4-px grid; card padding 16; gaps 12/16; page padding 24 desktop, 16 phone.
- Radius: 10 for cards, 8 for controls; one border colour (`hairline`); elevation only for
  popovers/dialogs.
- Status colours from the existing option colours; one `StatusPill` component for task/run/
  project status; one `Badge` for counts.
- Empty states: one muted line, never a full empty section; hide zero counts and unknown usage.

## 4. Pages

- **Overview**: top summary strip (4 small stat tiles: 活跃项目, 进行中任务, 待办, 运行中执行)
  each clickable; then project cards grid (2–3 columns) — card: name + status pill + pin;
  goal clamped to 2 lines; one progress bar for the current stage only (name + done/total);
  one line "最新：<report title> · <relative time>" if any; footer chips only when non-zero
  (sessions, to-dos, running task). The to-do column stays on the right on wide screens as a
  compact list grouped by kind with counts; on phones it is the 待办 tab.
- **Project page**: single header (breadcrumb, title, status pill, 2 actions: 新建会话,
  更多); body = two panes on desktop (chat 55 % / tabs 45 %), one pane with segmented tabs on
  phones. Chat: centred column max 760 px; bubbles with 14-px text; starter prompts as small
  chips; composer card with model picker as a compact select inside the card footer.
  Tabs: 任务 / 执行 / 汇报 / 会话 / 信息; each tab content uses section cards with the type scale.
- **Table view**: sticky header, 36-px rows, subtle zebra, status/priority as pills, column
  widths fixed for status/priority/updated; toolbar as one row (filter, group, sort, 新任务,
  字段) with filters in a popover.
- **Resources**: server group summary as 4 compact tiles; resource cards with a
  consistent header (icon by kind, title, state pill), GPUs as a compact list (one line per GPU:
  index, model short name, memory bar, util %); API cards show configured keys as small pills.
- Dark and light both checked; WCAG AA contrast for text.

## 5. Constraints

- Frontend only (web/). No API changes; reuse protocol/home.ts. Keep every existing
  data-testid used by `web/scripts/home-check.mjs` and `board-check.mjs`, or update those
  scripts in the same change so they still pass.
- Keep i18n (zh/en), chrome-vocabulary, no-raw-dialogs and wired tests green; add vitest for
  the shell pieces (nav model: active item from route, project ordering/badges, keyboard map).
- No horizontal page scroll at 360 px; lazy chunks stay (HomePage chunk must not import xterm).
