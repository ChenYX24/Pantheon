<p align="center">
  <img src="docs/logo.png" alt="Super Claude Code" width="120" />
</p>

<h1 align="center">Super Claude Code</h1>

<p align="center">
  <strong>The management dashboard for Claude Code — monitor, chat, orchestrate, research, and customize.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#screenshots">Screenshots</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="./README_CN.md">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-4.4.0-blue" alt="Version" />
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

### ARIS Research Pipeline

| Feature | Description |
|---------|-------------|
| **6-Stage Workflow** | Literature → Validation → Design → Experiment → Review → Paper |
| **Custom Pipeline** | Visual DAG editor with drag-and-drop skill nodes |
| **4 Templates** | Idea Discovery, Auto Review, Paper Writing, Full Research Pipeline |
| **Execution Dashboard** | Live logs, mini DAG, file browser, checkpoint approval |
| **Auto Report** | Structured report with timeline on pipeline completion |
| **Stage Sync** | Auto-updates stage status when skills complete |

### Agent Teams

| Feature | Description |
|---------|-------------|
| **Visual Canvas** | React Flow team editor with drag-and-drop agent nodes |
| **5 Presets** | Pair Programming, TDD Squad, Full Stack Team, Research & Analysis, etc. |
| **Multi-Provider** | Each agent can use different model (Claude / GPT-5.4 / DeepSeek) |
| **Execution** | Sequential / Parallel / Hierarchical workflows with live logs |
| **Run History** | Browse past executions with per-agent status and logs |

### Configuration

| Feature | Description |
|---------|-------------|
| **Toolbox** | 5-tab hub: MCP servers, Skills, Hooks, Agents, Rules — with marketplace |
| **API Keys** | Manage keys for 15+ providers with balance/model queries |
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

| ARIS Research | Agent Teams |
|---------------|-------------|
| ![ARIS](docs/screenshots/aris-pipeline.png) | ![Teams](docs/screenshots/agent-teams.png) |

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
│   │   ├── aris-research/      # ARIS Research (9.6K LOC)
│   │   ├── agent-teams/        # Agent Teams (3.5K LOC)
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
| Graphs | **React Flow** (Skill Tree, ARIS Canvas, Agent Teams) |
| Charts | **Recharts** (Token analytics) |
| Data | Local filesystem (`~/.claude/`, `~/.codex/`) |
| i18n | **next-intl** (EN / 中文) |
| State | localStorage + file-based persistence |

### Supported Models

| Provider | Models |
|----------|--------|
| **Claude** | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
| **OpenAI (Codex)** | gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.3-codex, codex-mini-latest |
| **OpenAI (Reasoning)** | o3-pro, o3, o4-mini, o1, o1-mini |
| **OpenAI (GPT)** | gpt-5.3, 5.2, 5, 4.1, 4.1-mini, 4.1-nano, 4o, 4o-mini |
| **API Providers** | DeepSeek, SiliconFlow, Moonshot, Zhipu, OpenRouter, Groq, Together, Google, Mistral, ... |

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| **v4.4.0** | 2026-03-18 | Skill Tree (smart creator + auto-detect + config), ARIS report, Agent Teams refactor, Chat perf |
| **v4.3.0** | 2026-03-17 | Skill Tree dual view (list + graph), 49 skills, 8 categories |
| **v4.1.0** | 2026-03-17 | ARIS results, checkpoints, notifications, Agent Teams executor |
| **v4.0.0** | 2026-03-17 | Agent Teams canvas, ARIS engine, workspace system |
| **v3.1.0** | 2026-03-16 | Agent Teams plugin, ARIS Research plugin, Turbopack |
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

## License

MIT

---

<p align="center">
  Built with Claude Code + Super Claude Code
</p>
