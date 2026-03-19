<p align="center">
  <img src="public/logo.svg" alt="Pantheon" width="128" />
</p>

<h1 align="center">Pantheon</h1>

<p align="center">
  <strong>AI Agent 编排平台 (PTN) — 监控、聊天、编排、科研、定制。</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> &bull;
  <a href="#快速开始">快速开始</a> &bull;
  <a href="#截图">截图</a> &bull;
  <a href="#架构">架构</a> &bull;
  <a href="./README.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-4.6.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/i18n-EN%20%7C%20中文-orange" alt="i18n" />
</p>

---

## 功能特性

### 仪表盘与监控

| 功能 | 说明 |
|------|------|
| **总览** | 6 张统计卡片、活跃进程检测、7 天 Token 趋势迷你图、快捷操作 |
| **会话管理** | 网格/列表视图、ClaudeGlance 颜色状态、搜索/筛选/收藏、Markdown 导出 |
| **会话分析** | 统一 Diff 视图（LCS 算法）、工具分类聚合、文件热点图、Token 时间线迷你图、AI 自动洞察 |
| **Token 分析** | 交互式图表（刷选缩放）、模型饼图、CSV 导出、费用追踪 |
| **任务队列** | 后台任务管理，自动刷新 |

### AI 聊天

| 功能 | 说明 |
|------|------|
| **流式聊天** | GPT 风格界面，实时流式响应，工具调用可视化 |
| **多模型切换** | Claude 与 Codex 一键切换（GPT-5.4 / o3-pro / codex-mini） |
| **双屏对比** | Claude vs Codex 并排对比模式 |
| **斜杠命令** | 输入 `/` 触发命令菜单，模糊搜索 + 键盘导航 |
| **命令面板** | Ctrl+K 全局搜索（页面/命令/会话） |

### 技能树

| 功能 | 说明 |
|------|------|
| **双视图** | 列表视图（8 大分类）+ 图谱视图（React Flow 六边形节点 + Tier 分层） |
| **49+ 技能** | 基建、编程、科研、管理、创意、集成、高级、其他 |
| **自动检测** | 「检测配置」按钮 + 「全部检测」批量验证 |
| **智能创建** | 用自然语言描述需求，AI 自动分析依赖并创建技能图 |
| **参数配置** | 每个技能可配参数（如实验运行器的 SSH 服务器下拉框） |
| **使用示例** | 「试试看」区域，含可点击链接和终端命令 |
| **依赖检查** | 前置依赖未满足时阻止激活，显示警告 |

### SAGE 科研流水线

| 功能 | 说明 |
|------|------|
| **6 阶段工作流** | 文献调研 → 验证筛选 → 方案设计 → 实验执行 → 评审迭代 → 论文撰写 |
| **自定义流水线** | 可视化 DAG 编辑器，拖拽技能节点 |
| **4 个模板** | 选题发现、自动评审、论文写作、全流程研究 |
| **执行仪表盘** | 实时日志、迷你 DAG、文件浏览、检查点审批 |
| **自动报告** | 流水线完成后生成结构化报告（摘要卡片 + 时间线） |
| **阶段同步** | 技能完成时自动更新阶段状态 |

### 每日简报

| 功能 | 说明 |
|------|------|
| **杂志卡片** | 精美视觉卡片，120x80px 缩略图，数据源专属渐变备选图 |
| **9 大数据源** | GitHub、HuggingFace、ArXiv、RSS、Web 搜索、RSSHub（小红书/B站/微博）、YouTube、金融（Finnhub/Yahoo）、自定义 API |
| **分类标签** | 按需求标签导航 — 查看全部或按研究方向分类 |
| **分类 AI 摘要** | 每个分类生成独立的 AI 摘要 |
| **推送通知** | 推送简报到 Telegram（Markdown 格式）和飞书（交互式卡片） |
| **网格/列表** | 列表与双列网格布局一键切换 |
| **代理支持** | 自动检测代理，适配国内网络访问 |

### 工作流工作室

| 功能 | 说明 |
|------|------|
| **可视化画布** | React Flow 团队编辑器，拖拽添加 Agent 节点 |
| **5 个预设** | 结对编程、TDD 小队、全栈团队、研究分析等 |
| **多模型协作** | 每个 Agent 可使用不同模型（Claude / GPT-5.4 / DeepSeek） |
| **异步优先** | 全异步 Store 迁移消除竞态条件；AbortController 取消机制 |
| **错误韧性** | 速率限制（429）检测、SSE 错误处理、生产环境 console.log 守卫 |
| **执行编排** | 顺序 / 并行 / 层级工作流，实时日志 |
| **执行历史** | 浏览历史运行记录，展开查看每个 Agent 状态和日志 |

### 配置管理

| 功能 | 说明 |
|------|------|
| **工具箱** | 5 标签页：MCP 服务器、技能、Hooks、Agent、规则 — 含商店 |
| **API 密钥** | 管理 15+ 平台密钥，查询余额/模型列表，机器无关加密，HTTP 头部净化 |
| **CLAUDE.md 编辑器** | 分栏编辑 + 预览，Registry 支持 |
| **设置中心** | 模型选择器、Bot 向导、权限管理、语言切换 |
| **Telegram / 飞书** | Bot 集成，通知推送与远程控制 |

### 通用特性

| 功能 | 说明 |
|------|------|
| **国际化** | 中英文完整支持，一键切换 |
| **暗色模式** | 跟随系统，全页面一致 |
| **PWA** | 可安装为桌面/移动端应用 |
| **响应式** | 移动端优化布局 |
| **键盘快捷键** | 1-8 页面导航，Ctrl+K 命令面板 |

---

## 截图

<details>
<summary><strong>点击展开截图</strong></summary>

| 总览 | 聊天 |
|------|------|
| ![总览](docs/screenshots/overview.png) | ![聊天](docs/screenshots/chat.png) |

| 技能树（列表） | 技能树（图谱） |
|----------------|----------------|
| ![技能树列表](docs/screenshots/skill-tree-list.png) | ![技能树图谱](docs/screenshots/skill-tree-graph.png) |

| SAGE 科研 | 工作流工作室 |
|-----------|-----------|
| ![SAGE](docs/screenshots/aris-pipeline.png) | ![团队](docs/screenshots/agent-teams.png) |

| Token 分析 | 工具箱 |
|------------|--------|
| ![Tokens](docs/screenshots/tokens.png) | ![工具箱](docs/screenshots/toolbox.png) |

</details>

---

## 快速开始

### 前置条件

- **Node.js 18+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- 可选：**Codex CLI** — `npm install -g @openai/codex`（双模型聊天）

### 安装运行

```bash
git clone https://github.com/ChenYX24/Super-Claude-Code.git
cd Super-Claude-Code/dashboard
npm install
npm run dev
```

打开 **http://localhost:3000**

### 生产构建

```bash
npm run build
npm start
```

### Claude Code 集成

```bash
# 打开当前会话的仪表盘
claude "/dashboard"

# 打开所有会话的仪表盘
claude "/dashboard_all"
```

---

## 架构

```
dashboard/
├── src/
│   ├── app/                    # Next.js 16 App Router
│   │   ├── api/                # 30+ API 路由
│   │   └── plugins/[pluginId]/ # 动态插件页面
│   ├── plugins/                # 模块化插件系统
│   │   ├── skill-tree/         # 技能树 (1.8K 行)
│   │   ├── aris-research/      # SAGE 科研 (9.6K 行)
│   │   ├── agent-teams/        # 工作流工作室 (3.5K 行)
│   │   ├── daily-briefing/     # 每日简报 (9 数据源, AI 摘要)
│   │   └── api-management/     # API 密钥管理
│   ├── components/             # 共享 UI (shadcn/ui)
│   ├── lib/                    # 核心逻辑
│   │   ├── providers/          # Claude + Codex CLI 适配器
│   │   └── execution/          # 共享执行器
│   └── i18n/                   # 国际化 (en, zh-CN)
├── messages/                   # i18n 翻译文件
└── public/                     # 静态资源 + PWA manifest
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | **Next.js 16**（App Router + Turbopack） |
| 语言 | **TypeScript 5.x** |
| 样式 | **Tailwind CSS v4** |
| UI | **shadcn/ui** |
| 图可视化 | **React Flow**（技能树、SAGE 画布、工作流工作室） |
| 数据图表 | **Recharts**（Token 分析） |
| 数据源 | 本地文件（`~/.claude/`、`~/.codex/`） |
| 国际化 | **next-intl**（EN / 中文） |

### 支持的模型

| 提供者 | 模型 |
|--------|------|
| **Anthropic** | Claude Opus 4.6、Sonnet 4.6、Haiku 4.5 |
| **OpenAI** | GPT-5.4 系列、o3/o4 推理系列、GPT-4.1 系列、codex-mini |
| **API 服务商** | DeepSeek、硅基流动、Moonshot、智谱、OpenRouter、Groq、Google、Mistral 等 |

---

## 版本历史

| 版本 | 日期 | 亮点 |
|------|------|------|
| **v4.6.0** | 2026-03-20 | 每日简报 v2（9 数据源、杂志卡片、推送）、会话分析、工作流工作室异步重构、API 密钥加密修复 |
| **v4.5.0** | 2026-03-18 | 品牌升级为 Pantheon，SAGE 科研流水线，代码质量优化 |
| **v4.4.0** | 2026-03-18 | 技能树智能创建 + SAGE 报告 + 工作流工作室重构 + 聊天性能 |
| **v4.3.0** | 2026-03-17 | 技能树双视图，49 技能，8 大分类 |
| **v4.1.0** | 2026-03-17 | SAGE 结果查看、检查点、通知、Agent 执行器 |
| **v4.0.0** | 2026-03-17 | 工作流工作室画布、SAGE 引擎、工作区 |
| **v3.0.0** | 2026-03-16 | API 管理、性能优化、完整国际化 |
| **v2.0.0** | 2026-02-23 | 流式聊天、Codex 集成、Provider 系统 |
| **v1.0.0** | 2026-02-20 | GPT 风格聊天、会话管理、工具箱 |

---

## 贡献

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交更改：`git commit -m "feat: 添加新功能"`
4. 推送：`git push origin feature/my-feature`
5. 发起 Pull Request

---

## 路线图

### v4.7 — 打磨与扩展
- [ ] 技能树：子技能展开（深入技能内部能力点）
- [ ] 技能树：禁用时真正移除对应 skill/MCP
- [ ] SAGE：节点右键菜单、智能参数推断
- [ ] 工作流工作室：画布撤销/重做、团队导入导出
- [ ] **决策节点**：工作流工作室条件分支（决策门 + 聚合器）
- [ ] **SAGE 多项目**：并行研究项目支持，独立阶段追踪
- [ ] **技能树 x 简报**：从 GitHub 发现技能 → AI 推荐 → Bubble UX → Claude Code 开发

### v5.0 — 金融与智能
- [ ] **股票仪表盘**：多市场金融面板（A股/港股/美股/台股、金银、板块、AI 交易）
- [ ] 智能任务路由 — AI 自动分派任务给最佳 Agent
- [ ] 多平台 Bot（微信 / Discord）

### v6.0 — 自主劳动力
- [ ] 任务市场 MVP — 接入外部任务源
- [ ] 自动评估 & 投标自由职业任务
- [ ] 沙箱执行环境
- [ ] 收益仪表盘 & 交付追踪

---

## 许可证

MIT

---

<p align="center">
  基于 Claude Code + Pantheon 构建
</p>
