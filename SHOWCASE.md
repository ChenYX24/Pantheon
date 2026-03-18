# Super Claude Code — Feature Showcase & Testing Guide

## Quick Start (Zero Experience)

### Prerequisites
- Node.js 18+ installed
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Git installed

### Launch
```bash
cd dashboard
npm install
npm run dev
# Open http://localhost:3000
```

---

## Feature Tour (Recommended Order)

### 1. Overview Page (`/`)
**What to show:** Stats dashboard, active processes, token summary with 7-day sparkline.
- Observe the 6 stat cards auto-populate
- Click Quick Actions to jump to different modules
- Token Summary shows real usage if you've used Claude Code before

### 2. Sessions (`/sessions`)
**What to show:** Session browsing with ClaudeGlance colors.
- Switch between Grid/List view
- Click a session card to see full conversation
- Try the search, date filter, model filter
- Star a session (persists in localStorage)
- Click "Open in Chat" to continue a conversation

### 3. Chat (`/chat`)
**What to show:** GPT-style Claude Code interaction.
- Type a message and send (Enter)
- Type `/` to see slash command menu (arrow keys + Enter to select)
- Try Shift+Enter for multi-line
- Drag a file onto the input area
- Watch streaming response with tool call visualization
- Use Ctrl+K for command palette

### 4. Skill Tree (`/plugins/skill-tree`)
**What to show:** Game-style capability map.
- **List View:** Browse 49+ skills across 8 categories
- **Graph View:** Toggle to see React Flow DAG with hex nodes
- **Scan All:** Click the sky-blue "Scan All" button to auto-detect all skills
- **Verify Setup:** Click any skill → "Verify Setup" button in detail panel
- **Smart Add:** Click purple "Smart Add" → describe a skill (e.g., "stock trading") → watch AI analyze dependencies
- **Custom CRUD:** Click "Add Skill" → fill form → see it appear with violet badge
- Switch language (sidebar globe) to see Chinese/English toggle

### 5. ARIS Research (`/plugins/aris-research`)
**What to show:** Autonomous research pipeline.
- **Stage Pipeline:** See the 6-stage research workflow
- **Custom Pipeline:** Click "Custom Pipeline" → choose a template (e.g., "Idea Discovery")
- **Design Canvas:** Drag skills from left panel onto canvas, connect nodes
- **Node Config:** Click a node to set parameters, enable checkpoint
- **Execute:** Click Run → watch execution dashboard with live logs
- **Report:** After completion, see auto-generated report with timeline

### 6. Agent Teams (`/plugins/agent-teams`)
**What to show:** Multi-agent team orchestration.
- Browse 5 preset templates (e.g., "Pair Programming", "TDD Squad")
- Click a preset → see team card with members
- **Visual Editor:** Click canvas icon → see React Flow team graph
- **Drag Members:** From left palette, drag agent templates onto canvas
- **Edit Member:** Click node → edit name, model, system prompt
- **Execute:** Enter a task → watch agents collaborate sequentially
- **History:** Click clock icon to see past execution runs

### 7. Tokens (`/tokens`)
**What to show:** Usage analytics.
- Area chart with brush zoom
- Switch time ranges (7d/14d/30d/all)
- Model distribution pie chart
- CSV export button

### 8. Toolbox (`/toolbox`)
**What to show:** Configuration center.
- 5 tabs: MCP / Skills & Commands / Hooks / Agents / Rules
- MCP marketplace (14 popular servers)
- Template store for skills/agents/rules
- AI Creator: describe what you want → generate SKILL.md

### 9. Settings (`/settings`)
**What to show:** Configuration management.
- General/Bots/Advanced tabs
- Telegram bot setup wizard (3-step guide)
- Language switcher
- Permission mode selector

---

## Video Recording Guide

### Recommended Tool
- **OBS Studio** (free, cross-platform) — best for long recordings
- **Windows:** Win+G (Xbox Game Bar) for quick clips
- **macOS:** Cmd+Shift+5

### Recording Settings
- Resolution: 1920x1080 (Full HD)
- Frame rate: 30 FPS
- Browser: Chrome/Edge in dark mode
- Font size: Ensure text is readable at 1080p

### Suggested Video Structure (3-5 min)

**Intro (15s)**
- Show the landing page, briefly explain what SCC is

**Core Demo (2-3 min)**
1. Chat page — send a message, show streaming (30s)
2. Skill Tree — scan all, smart add a skill (45s)
3. ARIS — pick a template, show canvas, start execution (45s)
4. Agent Teams — show preset, open canvas, drag members (30s)
5. Tokens — show usage chart (15s)

**Outro (15s)**
- Show language switch (EN → CN)
- Show mobile responsiveness (resize browser)

### Post-production
- Speed up waiting/loading at 2-4x
- Add captions for key actions
- Trim dead air
- Export as MP4 (H.264)

### Hosting
- Upload to YouTube (unlisted or public)
- Or use GitHub's own video embed: drag MP4 into README editor
- Or use a GIF for short clips: `ffmpeg -i video.mp4 -vf "fps=10,scale=800:-1" demo.gif`

---

## Professional README Structure

Your GitHub README should follow this structure:

```markdown
# Super Claude Code

> A management dashboard for Claude Code — monitor sessions, chat, orchestrate agents, manage skills, and run research pipelines.

![Demo](docs/demo.gif)

## Features

- **Dashboard** — Real-time session monitoring, token usage tracking
- **Chat** — GPT-style Claude Code interaction with streaming
- **Skill Tree** — Game-style capability visualization with AI-powered skill creation
- **ARIS Research** — Autonomous research pipeline (idea → paper)
- **Agent Teams** — Multi-agent visual orchestration
- **Toolbox** — MCP servers, skills, hooks, agents, rules management
- **i18n** — English + Chinese

## Quick Start

\```bash
git clone https://github.com/ChenYX24/Super-Claude-Code.git
cd Super-Claude-Code/dashboard
npm install
npm run dev
\```

Open http://localhost:3000

## Prerequisites

- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

## Screenshots

| Overview | Chat | Skill Tree |
|----------|------|------------|
| ![](docs/screenshots/overview.png) | ![](docs/screenshots/chat.png) | ![](docs/screenshots/skill-tree.png) |

| ARIS Research | Agent Teams | Tokens |
|---------------|-------------|--------|
| ![](docs/screenshots/aris.png) | ![](docs/screenshots/teams.png) | ![](docs/screenshots/tokens.png) |

## Architecture

- **Framework:** Next.js 16 + TypeScript + Tailwind v4
- **UI:** shadcn/ui + Recharts + React Flow
- **Data:** Reads directly from `~/.claude/` JSON/JSONL files
- **Plugins:** Modular plugin system (API Management, Agent Teams, ARIS, Skill Tree)

## License

MIT
```

---

## Screenshot Capture Tips

1. Use browser DevTools → Device Toolbar → set to 1920x1080
2. For each page, make sure there's actual data visible
3. Dark mode preferred (looks better in README)
4. Capture at 2x resolution if on HiDPI display
5. Save as PNG, optimize with `pngquant` or TinyPNG

### Key Screenshots to Capture
- [ ] Overview with stats populated
- [ ] Chat with a conversation showing tool calls
- [ ] Skill Tree list view with categories expanded
- [ ] Skill Tree graph view with hex nodes
- [ ] ARIS custom pipeline canvas with nodes connected
- [ ] ARIS execution dashboard during/after run
- [ ] Agent Teams canvas with members connected
- [ ] Tokens chart with usage data
- [ ] Settings page
- [ ] Mobile view (narrow browser)

---

## Testing Checklist

### Smoke Test (5 min)
- [ ] `npm run dev` starts without errors
- [ ] All 10 pages load without console errors
- [ ] Language switch works (EN ↔ CN)
- [ ] Dark mode renders correctly

### Feature Test (15 min)
- [ ] Chat: send message → get streaming response
- [ ] Skill Tree: Scan All → skills change to "active"
- [ ] Skill Tree: Smart Add → describe skill → confirm creation
- [ ] Skill Tree: Custom skill CRUD (add → edit → delete)
- [ ] ARIS: Select template → see canvas → configure node → run
- [ ] Agent Teams: Create team from preset → open canvas → execute
- [ ] Sessions: Browse, search, star, export
- [ ] Tokens: Chart renders, CSV export works
- [ ] Toolbox: Browse MCP marketplace, create a skill via AI

### Cross-browser
- [ ] Chrome
- [ ] Edge
- [ ] Firefox (React Flow may need testing)
