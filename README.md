<p align="center">
  <img src="public/logo.svg" alt="Pantheon" width="128" />
</p>

<h1 align="center">Pantheon</h1>

<p align="center">
  <strong>AI Agent Orchestration Platform (PTN) — monitor, chat, orchestrate, research, and customize.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#screenshots">Screenshots</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="./README_CN.md">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-4.6.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/i18n-EN%20%7C%20中文-orange" alt="i18n" />
</p>

<!-- TODO: Add demo GIF here -->
<!-- ![Demo](docs/demo.gif) -->

---

## Features

### Dashboard & Monitoring

| Feature | Description |
|---------|-------------|
| **Overview** | 6 stat cards, active process detection, 7-day token sparkline, quick actions |
| **Sessions** | Grid/List view, ClaudeGlance colors, search, filters, favorites, markdown export |
| **Session Analytics** | Unified diff view (LCS-based), tool category grouping, file hotspots heatmap, token timeline sparkline, AI auto-insights |
| **Tokens** | Interactive charts with brush zoom, model pie chart, CSV export, cost tracking |
| **Queue** | Background task queue management with auto-refresh |

### AI Chat

| Feature | Description |
|---------|-------------|
| **Streaming Chat** | GPT-style interface with real-time streaming, tool call visualization |
| **Multi-Provider** | Switch between Claude and Codex (GPT-5.4 / o3-pro / codex-mini) |
| **Dual Compare** | Side-by-side Claude vs Codex comparison mode |
| **Slash Commands** | `/` triggers command menu with fuzzy search and keyboard navigation |
| **Command Palette** | Ctrl+K global search across pages, commands, sessions |

### Skill Tree

| Feature | Description |
|---------|-------------|
| **Dual View** | List view (8 categories) + Graph view (React Flow hex nodes with tier bands) |
| **49+ Skills** | Foundation, Coding, Research, Management, Creative, Integration, Advanced |
| **Auto-Detect** | Verify Setup button + Scan All batch verification |
| **Smart Creator** | Describe a skill in natural language — AI analyzes dependencies and creates skill graph |
| **Config Fields** | Per-skill parameter UI (e.g., SSH server selector for Experiment Runner) |
| **Usage Examples** | "Try It" section with clickable links and terminal commands |
| **Dependency Check** | Blocks activation if prerequisites not met, shows warning |

### SAGE Research Pipeline

| Feature | Description |
|---------|-------------|
| **6-Stage Workflow** | Literature → Validation → Design → Experiment → Review → Paper |
| **Custom Pipeline** | Visual DAG editor with drag-and-drop skill nodes |
| **4 Templates** | Idea Discovery, Auto Review, Paper Writing, Full Research Pipeline |
| **Execution Dashboard** | Live logs, mini DAG, file browser, checkpoint approval |
| **Auto Report** | Structured report with timeline on pipeline completion |
| **Stage Sync** | Auto-updates stage status when skills complete |

### Daily Briefing

| Feature | Description |
|---------|-------------|
| **Magazine Cards** | Rich visual cards with 120x80px thumbnails and source-specific gradient fallbacks |
| **9 Data Sources** | GitHub, HuggingFace, ArXiv, RSS, Web Search, RSSHub (Xiaohongshu/Bilibili/Weibo), YouTube, Finance (Finnhub/Yahoo), Custom API |
| **Category Tabs** | Need-based tab navigation — view all items or filter by research category |
| **Per-Need AI Summaries** | Each category gets its own AI-generated summary |
| **Push Notifications** | Push briefing to Telegram (Markdown) and Feishu (Interactive Card) |
| **Grid/List View** | Toggle between list and 2-column grid layout |
| **Proxy Support** | Automatic proxy detection for China network access |

### Workflow Studio

| Feature | Description |
|---------|-------------|
| **Visual Canvas** | React Flow team editor with drag-and-drop agent nodes |
| **5 Presets** | Pair Programming, TDD Squad, Full Stack Team, Research & Analysis, etc. |
| **Multi-Provider** | Each agent can use different model (Claude / GPT-5.4 / DeepSeek) |
| **Async-First** | Full async store migration eliminates race conditions; AbortController cancellation |
| **Error Resilience** | Rate limit (429) detection, SSE error handling, production console.log guards |
| **Execution** | Sequential / Parallel / Hierarchical workflows with live logs |
| **Run History** | Browse past executions with per-agent status and logs |

### Configuration

| Feature | Description |
|---------|-------------|
| **Toolbox** | 5-tab hub: MCP servers, Skills, Hooks, Agents, Rules — with marketplace |
| **API Keys** | Manage keys for 15+ providers with balance/model queries, machine-independent encryption, HTTP header sanitization |
| **CLAUDE.md Editor** | Split editor + preview, registry support |
| **Settings** | Model selectors, bot wizards, permissions, language switch |
| **Telegram/Feishu** | Bot integration for notifications and remote control |

### Cross-cutting

| Feature | Description |
|---------|-------------|
| **i18n** | Full English + Chinese support, one-click switch |
| **Dark Mode** | System-aware, consistent across all pages |
| **PWA** | Installable as desktop/mobile app |
| **Responsive** | Mobile-optimized layouts |
| **Keyboard Shortcuts** | 1-8 page navigation, Ctrl+K command palette |

---

## Screenshots

<!-- Replace these with actual screenshots after capturing -->

<details>
<summary><strong>Click to expand screenshots</strong></summary>

| Overview | Chat |
|----------|------|
| ![Overview](docs/screenshots/overview.png) | ![Chat](docs/screenshots/chat.png) |

| Skill Tree (List) | Skill Tree (Graph) |
|--------------------|-------------------|
| ![Skill Tree List](docs/screenshots/skill-tree-list.png) | ![Skill Tree Graph](docs/screenshots/skill-tree-graph.png) |

| SAGE Research | Workflow Studio |
|---------------|-------------|
| ![SAGE](docs/screenshots/aris-pipeline.png) | ![Teams](docs/screenshots/agent-teams.png) |

| Tokens | Toolbox |
|--------|---------|
| ![Tokens](docs/screenshots/tokens.png) | ![Toolbox](docs/screenshots/toolbox.png) |

</details>

---

## Quick Start

### Prerequisites

- **Node.js 18+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- Optional: **Codex CLI** — `npm install -g @openai/codex` (for dual-provider chat)

### Install & Run

```bash
git clone https://github.com/ChenYX24/Super-Claude-Code.git
cd Super-Claude-Code/dashboard
npm install
npm run dev
```

Open **http://localhost:3000**

### Build for Production

```bash
npm run build
npm start
```

### Claude Code Integration

```bash
# Open dashboard for current session
claude "/dashboard"

# Open dashboard for all sessions
claude "/dashboard_all"
```

---

## Architecture

```
dashboard/
├── src/
│   ├── app/                    # Next.js 16 App Router
│   │   ├── api/                # 30+ API routes
│   │   ├── chat/               # Chat page
│   │   ├── sessions/           # Sessions page
│   │   ├── tokens/             # Token analytics
│   │   ├── toolbox/            # Toolbox hub
│   │   ├── editor/             # CLAUDE.md editor
│   │   ├── settings/           # Settings
│   │   ├── queue/              # Task queue
│   │   └── plugins/[pluginId]/ # Dynamic plugin pages
│   ├── plugins/                # Modular plugin system
│   │   ├── skill-tree/         # Skill Tree (1.8K LOC)
│   │   ├── aris-research/      # SAGE Research (9.6K LOC)
│   │   ├── agent-teams/        # Workflow Studio (3.5K LOC)
│   │   ├── daily-briefing/     # Daily Briefing (9 sources, AI summaries)
│   │   └── api-management/     # API Key Management
│   ├── components/             # Shared UI (shadcn/ui)
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Core logic
│   │   ├── providers/          # Claude + Codex CLI adapters
│   │   ├── execution/          # Shared executor (BaseExecutor, topoSort)
│   │   ├── api-vault/          # Key store + provider checker
│   │   └── *.ts                # Readers, formatters, utilities
│   └── i18n/                   # Internationalization (en, zh-CN)
├── messages/                   # i18n translation files
└── public/                     # Static assets + PWA manifest
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 16** (App Router + Turbopack) |
| Language | **TypeScript 5.x** |
| Styling | **Tailwind CSS v4** |
| UI | **shadcn/ui** |
| Graphs | **React Flow** (Skill Tree, SAGE Canvas, Workflow Studio) |
| Charts | **Recharts** (Token analytics) |
| Data | Local filesystem (`~/.claude/`, `~/.codex/`) |
| i18n | **next-intl** (EN / 中文) |
| State | localStorage + file-based persistence |

### Supported Models

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 |
| **OpenAI** | GPT-5.4 family, o3/o4 reasoning, GPT-4.1 family, codex-mini |
| **API Providers** | DeepSeek, SiliconFlow, Moonshot, Zhipu, OpenRouter, Groq, Google, Mistral, ... |

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| **v4.6.0** | 2026-03-20 | Daily Briefing v2 (9 sources, magazine cards, push), Session Analytics, Workflow Studio async-first, API key encryption fix |
| **v4.5.0** | 2026-03-18 | Rebranded to Pantheon, SAGE research pipeline, code quality improvements |
| **v4.4.0** | 2026-03-18 | Skill Tree (smart creator + auto-detect + config), SAGE report, Workflow Studio refactor, Chat perf |
| **v4.3.0** | 2026-03-17 | Skill Tree dual view (list + graph), 49 skills, 8 categories |
| **v4.1.0** | 2026-03-17 | SAGE results, checkpoints, notifications, Workflow Studio executor |
| **v4.0.0** | 2026-03-17 | Workflow Studio canvas, SAGE engine, workspace system |
| **v3.1.0** | 2026-03-16 | Workflow Studio plugin, SAGE Research plugin, Turbopack |
| **v3.0.0** | 2026-03-16 | API Management, performance optimization, full i18n |
| **v2.1.0** | 2026-02-24 | Settings refactor, Queue, Telegram/Feishu, testing |
| **v2.0.0** | 2026-02-23 | Chat streaming, Codex integration, provider system |
| **v1.0.0** | 2026-02-20 | Chat GPT-style, sessions, toolbox, notifications |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m "feat: add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## Roadmap

### v4.7 — Polish & Expansion
- [ ] Skill Tree: sub-skill expansion (drill into skill internals)
- [ ] Skill Tree: disable actually removes skill/MCP from system
- [ ] SAGE: node right-click menu, smart parameter inference
- [ ] Workflow Studio: undo/redo in canvas, team export/import
- [ ] **Decision Nodes**: Conditional branching in Workflow Studio (Decision Gate + Aggregator)
- [ ] **SAGE Multi-Project**: Parallel research project support with independent stage tracking
- [ ] **Skill Tree x Briefing**: Discover skills from GitHub, AI recommend, Bubble UX, Claude Code develops

### v5.0 — Finance & Intelligence
- [ ] **Stock Dashboard**: Multi-market finance dashboard (A-shares / HK / US / TW, Gold/Silver, Sectors, AI Trading)
- [ ] Smart task routing — AI auto-dispatches tasks to best agent
- [ ] Multi-platform bot (WeChat / Discord)

### v6.0 — Autonomous Workforce
- [ ] Task marketplace MVP — accept tasks from external sources
- [ ] Auto-evaluate & bid on freelance tasks
- [ ] Sandboxed execution environment
- [ ] Revenue dashboard & delivery tracking

---

## License

MIT

---

<p align="center">
  Built with Claude Code + Pantheon
</p>
