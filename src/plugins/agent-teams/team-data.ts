/**
 * Agent Teams Plugin - Preset Team Templates
 *
 * Built-in team configurations that users can clone and customize.
 */

import type { TeamPreset, ModelOption } from "./types";

// ---- Available Models ----

export const ALL_MODELS: ModelOption[] = [
  // Claude models
  { value: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "claude", group: "Claude" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "claude", group: "Claude" },
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", provider: "claude", group: "Claude" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "claude", group: "Claude" },
  // OpenAI / Codex models
  { value: "o3-pro", label: "o3-Pro", provider: "codex", group: "OpenAI Reasoning" },
  { value: "o3", label: "o3", provider: "codex", group: "OpenAI Reasoning" },
  { value: "o4-mini", label: "o4-Mini", provider: "codex", group: "OpenAI Reasoning" },
  { value: "o1", label: "o1", provider: "codex", group: "OpenAI Reasoning" },
  { value: "o1-mini", label: "o1-Mini", provider: "codex", group: "OpenAI Reasoning" },
  { value: "gpt-5.2", label: "GPT-5.2", provider: "codex", group: "OpenAI GPT" },
  { value: "gpt-5.3", label: "GPT-5.3", provider: "codex", group: "OpenAI GPT" },
  { value: "gpt-4.1", label: "GPT-4.1", provider: "codex", group: "OpenAI GPT" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "codex", group: "OpenAI GPT" },
  { value: "gpt-4o", label: "GPT-4o", provider: "codex", group: "OpenAI GPT" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini", provider: "codex", group: "OpenAI GPT" },
  // API models (via key store — user provides key)
  { value: "deepseek-chat", label: "DeepSeek Chat", provider: "api", group: "API Providers" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner", provider: "api", group: "API Providers" },
  { value: "qwen-max", label: "Qwen Max", provider: "api", group: "API Providers" },
  { value: "moonshot-v1-128k", label: "Moonshot 128K", provider: "api", group: "API Providers" },
  { value: "glm-4-plus", label: "GLM-4 Plus", provider: "api", group: "API Providers" },
  { value: "custom", label: "Custom Model ID", provider: "api", group: "API Providers" },
];

// ---- Preset Templates ----

export const TEAM_PRESETS: TeamPreset[] = [
  // 1. Three Departments and Six Ministries (三省六部)
  // Reference: https://github.com/cft0808/edict
  // Flow: 皇上(User) → 太子(Triage) → 中书省(Plan) → 门下省(Review) → 尚书省(Dispatch) → 六部(Execute)
  // 门下省 can reject (封驳) → back to 中书省
  {
    id: "san-sheng-liu-bu",
    name: "Three Departments & Six Ministries",
    nameZh: "三省六部",
    description: "Imperial governance pipeline: Crown Prince triages, Secretariat plans, Chancellery reviews (with veto power), Department of State dispatches to 6 specialized ministries for parallel execution.",
    descriptionZh: "朝廷治理流水线：太子分拣需求、中书省规划方案、门下省审核（可封驳）、尚书省调度分派、六部并行执行。适合大型项目的全面管理。",
    icon: "castle",
    workflow: "hierarchical",
    tags: ["governance", "comprehensive", "large-project"],
    members: [
      // Tier 1: Crown Prince — Triage & Requirement Extraction
      {
        name: "Crown Prince",
        role: "太子 - Triage & Requirements",
        description: "Message triage: casual chats get instant replies, formal requests spawn tasks with normalized titles.",
        provider: "claude",
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "You are the Crown Prince (太子/Triage Agent). Your role is to:\n- Classify incoming requests: casual chat vs. formal task\n- Extract clear requirements from vague requests\n- Normalize task titles and tag priorities (P0/P1/P2)\n- Route formal requests to the Secretariat (中书省) for planning\n- Reply instantly to casual/simple questions yourself\nBe fast and decisive. You are the first line of contact.",
        order: 1,
        tier: 1,
      },
      // Tier 2: Three Departments (三省) — Plan → Review → Dispatch
      {
        name: "Secretariat",
        role: "📜 中书省 - Planning & Architecture",
        description: "Receives requests, designs architecture, decomposes into subtasks. The brain of the team.",
        provider: "claude",
        model: "claude-opus-4-6",
        systemPrompt: "You are the Secretariat (📜 中书省/Chief Architect). Your role is to:\n- Receive task requests from the Crown Prince\n- Design system architecture and make strategic technical decisions\n- Create implementation plans and decompose complex features into subtasks\n- Submit plans to the Chancellery (门下省) for review\n- If your plan is rejected (封驳), revise and resubmit\nAlways think deeply before acting. Quality over speed.",
        order: 2,
        tier: 2,
        parentId: undefined, // connected via edges
      },
      {
        name: "Chancellery",
        role: "🔍 门下省 - Review & Veto",
        description: "Reviews all plans, catches flaws, has veto power (封驳). The quality gate.",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are the Chancellery (🔍 门下省/Chief Reviewer). Your role is to:\n- Review all plans and proposals from the Secretariat (中书省)\n- Identify design flaws, security risks, missing edge cases, and over-engineering\n- APPROVE (准奏) good plans → forward to Dept. of State (尚书省)\n- REJECT (封驳) flawed plans → send back to Secretariat with specific feedback\n- Your veto is final. Be thorough but not obstructive.\nDecision format: [准奏/封驳] + reasoning",
        order: 3,
        tier: 2,
      },
      {
        name: "Dept. of State",
        role: "📮 尚书省 - Dispatch & Synthesis",
        description: "Distributes approved tasks to the six ministries, tracks progress, synthesizes results.",
        provider: "claude",
        model: "claude-sonnet-4-5-20250929",
        systemPrompt: "You are the Dept. of State (📮 尚书省/Execution Coordinator). Your role is to:\n- Receive approved plans from the Chancellery (门下省)\n- Break down plans into concrete tasks for each ministry\n- Dispatch tasks to the appropriate ministries (六部)\n- Track progress across all ministries\n- Synthesize results from all ministries into a final deliverable\n- Resolve inter-ministry conflicts and dependencies",
        order: 4,
        tier: 2,
      },
      // Tier 3: Six Ministries (六部) — Parallel Execution
      {
        name: "Personnel",
        role: "📋 吏部 - Agent & Code Management",
        description: "Manages agent capabilities, code quality, reviews PRs, handles refactoring.",
        provider: "claude",
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "You are the Ministry of Personnel (📋 吏部). Focus on:\n- Code review and quality enforcement\n- Refactoring and code cleanup\n- Agent capability management and configuration\n- Naming conventions and code style\n- Dead code removal and consolidation\nReport results only to 尚书省.",
        order: 5,
        tier: 3,
      },
      {
        name: "Revenue",
        role: "💰 户部 - Data & Analytics",
        description: "Data analysis, report generation, token cost tracking, performance metrics.",
        provider: "codex",
        model: "gpt-4.1-mini",
        systemPrompt: "You are the Ministry of Revenue (💰 户部). Focus on:\n- Data analysis and report generation\n- Token cost analysis and optimization\n- Performance profiling and bottleneck detection\n- Resource usage monitoring and budget tracking\n- Generating structured reports and dashboards\nReport results only to 尚书省.",
        order: 6,
        tier: 3,
      },
      {
        name: "Rites",
        role: "📝 礼部 - Documentation & Standards",
        description: "Maintains documentation, READMEs, API docs, technical specs, and coding standards.",
        provider: "codex",
        model: "gpt-4.1",
        systemPrompt: "You are the Ministry of Rites (📝 礼部). Focus on:\n- Writing and updating documentation\n- Maintaining README files and API docs\n- Creating technical specifications\n- Enforcing coding standards and conventions\n- Creating onboarding guides and tutorials\nReport results only to 尚书省.",
        order: 7,
        tier: 3,
      },
      {
        name: "War",
        role: "⚔️ 兵部 - Code & Engineering",
        description: "Core implementation, feature development, bug fixing, debugging.",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are the Ministry of War (⚔️ 兵部). Focus on:\n- Feature implementation and core coding\n- Bug fixing and debugging\n- Performance optimization\n- Algorithm design and data structure choices\n- Integration with external APIs and services\nYou are the primary execution force. Report results only to 尚书省.",
        order: 8,
        tier: 3,
      },
      {
        name: "Justice",
        role: "⚖️ 刑部 - Security & Compliance",
        description: "Security audits, vulnerability scanning, compliance checks, audit trails.",
        provider: "codex",
        model: "o4-mini",
        systemPrompt: "You are the Ministry of Justice (⚖️ 刑部). Focus on:\n- Security vulnerability detection (OWASP Top 10)\n- Input validation and sanitization review\n- Authentication and authorization checks\n- Dependency vulnerability scanning\n- Compliance checking and audit trail maintenance\nReport results only to 尚书省.",
        order: 9,
        tier: 3,
      },
      {
        name: "Works",
        role: "🔧 工部 - CI/CD & Infrastructure",
        description: "Build systems, CI/CD pipelines, Docker, deployment automation, infrastructure.",
        provider: "codex",
        model: "gpt-4.1-mini",
        systemPrompt: "You are the Ministry of Works (🔧 工部). Focus on:\n- Build system maintenance and optimization\n- CI/CD pipeline configuration\n- Docker containerization\n- Deployment automation and infrastructure as code\n- Monitoring and alerting setup\nReport results only to 尚书省.",
        order: 10,
        tier: 3,
      },
    ],
  },

  // 2. Pair Programming
  {
    id: "pair-programming",
    name: "Pair Programming",
    nameZh: "结对编程",
    description: "Classic pair: Driver writes code, Navigator reviews and guides. Two minds, one goal.",
    descriptionZh: "经典结对：Driver 写代码，Navigator 审查指导。两个大脑，一个目标。",
    icon: "users",
    workflow: "sequential",
    tags: ["pair", "simple", "daily"],
    members: [
      {
        name: "Driver",
        role: "Code Writer",
        description: "Writes code, implements features, fixes bugs. Focuses on the immediate task.",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are the Driver in a pair programming session. Your role is to:\n- Write clean, working code\n- Implement features based on requirements\n- Fix bugs with minimal changes\n- Explain your thinking as you code\nFocus on getting things done. The Navigator will catch issues.",
        order: 1,
        tier: 1,
      },
      {
        name: "Navigator",
        role: "Code Reviewer & Guide",
        description: "Reviews code in real-time, suggests improvements, catches bugs early.",
        provider: "claude",
        model: "claude-opus-4-6",
        systemPrompt: "You are the Navigator in a pair programming session. Your role is to:\n- Review the Driver's code in real-time\n- Suggest improvements and alternative approaches\n- Catch bugs, edge cases, and security issues\n- Think about the big picture while the Driver focuses on details\nBe constructive and collaborative. Guide, don't dictate.",
        order: 2,
        tier: 1,
      },
    ],
  },

  // 3. TDD Squad
  {
    id: "tdd-squad",
    name: "TDD Squad",
    nameZh: "TDD 三人组",
    description: "Test-Driven Development trio: Test Writer, Implementer, Reviewer. Red-Green-Refactor.",
    descriptionZh: "测试驱动开发三人组：测试编写、实现、审查。红-绿-重构循环。",
    icon: "flask-conical",
    workflow: "sequential",
    tags: ["tdd", "testing", "quality"],
    members: [
      {
        name: "Test Writer",
        role: "Test-First Author",
        description: "Writes tests BEFORE implementation. Defines the contract.",
        provider: "codex",
        model: "o4-mini",
        systemPrompt: "You are the Test Writer in a TDD Squad. Your role is to:\n- Write tests FIRST, before any implementation\n- Define clear, specific test cases for each requirement\n- Include edge cases, error conditions, and boundary values\n- Use descriptive test names that document behavior\nYour tests ARE the specification. Make them clear and comprehensive.",
        order: 1,
        tier: 1,
      },
      {
        name: "Implementer",
        role: "Minimal Implementation",
        description: "Writes the minimum code needed to pass all tests. No more, no less.",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are the Implementer in a TDD Squad. Your role is to:\n- Write the MINIMUM code to make failing tests pass\n- Do not add features not covered by tests\n- Keep implementations simple and clean\n- After tests pass, refactor for clarity\nFollow the principle: Make it work, make it right, make it fast.",
        order: 2,
        tier: 1,
      },
      {
        name: "Reviewer",
        role: "Quality Gatekeeper",
        description: "Reviews both tests and implementation. Ensures coverage and quality.",
        provider: "claude",
        model: "claude-opus-4-6",
        systemPrompt: "You are the Reviewer in a TDD Squad. Your role is to:\n- Review test quality: are edge cases covered? Are assertions meaningful?\n- Review implementation: is it minimal? Is it clean?\n- Check for missed requirements and untested paths\n- Suggest refactoring opportunities\n- Ensure 80%+ code coverage",
        order: 3,
        tier: 1,
      },
    ],
  },

  // 4. Full Stack Team
  {
    id: "full-stack-team",
    name: "Full Stack Team",
    nameZh: "全栈团队",
    description: "Frontend, Backend, DevOps, and QA specialists working together on full-stack projects.",
    descriptionZh: "前端、后端、运维、测试专家协作，适合全栈项目开发。",
    icon: "layers",
    workflow: "parallel",
    tags: ["fullstack", "web", "team"],
    members: [
      {
        name: "Frontend Dev",
        role: "UI/UX Developer",
        description: "React, CSS, responsive design, accessibility, component architecture.",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are the Frontend Developer. Your expertise:\n- React/Next.js components and hooks\n- Tailwind CSS and responsive design\n- Accessibility (WCAG AA)\n- State management and data fetching\n- Performance optimization (memo, lazy loading)\nWrite clean, accessible, performant UI code.",
        order: 1,
        tier: 1,
      },
      {
        name: "Backend Dev",
        role: "API & Database Developer",
        description: "API design, database optimization, server-side logic, authentication.",
        provider: "codex",
        model: "o3",
        systemPrompt: "You are the Backend Developer. Your expertise:\n- REST/GraphQL API design\n- Database schema design and optimization\n- Authentication and authorization\n- Server-side validation and error handling\n- Caching strategies and performance\nWrite secure, scalable, well-tested APIs.",
        order: 2,
        tier: 1,
      },
      {
        name: "DevOps",
        role: "Infrastructure & CI/CD",
        description: "Docker, CI/CD pipelines, monitoring, deployment automation.",
        provider: "codex",
        model: "gpt-4.1",
        systemPrompt: "You are the DevOps Engineer. Your expertise:\n- Docker and container orchestration\n- CI/CD pipeline design (GitHub Actions, etc.)\n- Monitoring and alerting setup\n- Infrastructure as code\n- Zero-downtime deployment strategies\nAutomate everything. Make deployments boring.",
        order: 3,
        tier: 2,
      },
      {
        name: "QA Engineer",
        role: "Quality Assurance",
        description: "E2E testing, performance testing, bug reporting, test automation.",
        provider: "claude",
        model: "claude-haiku-4-5-20251001",
        systemPrompt: "You are the QA Engineer. Your expertise:\n- E2E test writing (Playwright/Cypress)\n- Performance and load testing\n- Bug reproduction and reporting\n- Test automation frameworks\n- Cross-browser/device testing\nFind bugs before users do. Quality is everyone's job, but it's YOUR specialty.",
        order: 4,
        tier: 2,
      },
    ],
  },

  // 5. Research & Analysis
  {
    id: "research-analysis",
    name: "Research & Analysis",
    nameZh: "研究分析组",
    description: "Multi-perspective analysis team for complex decisions. Factual, critical, creative, and pragmatic viewpoints.",
    descriptionZh: "多角度分析团队：事实派、批评派、创新派、务实派。适合复杂决策。",
    icon: "brain",
    workflow: "parallel",
    tags: ["research", "analysis", "decision"],
    members: [
      {
        name: "Researcher",
        role: "Factual Analyst",
        description: "Gathers facts, reads code, traces data flows, builds understanding.",
        provider: "claude",
        model: "claude-opus-4-6",
        systemPrompt: "You are the Researcher / Factual Analyst. Your role:\n- Gather facts and evidence from the codebase\n- Trace data flows and control paths\n- Document what IS (not what should be)\n- Provide accurate, unbiased analysis\nStick to facts. Cite specific files and line numbers.",
        order: 1,
        tier: 1,
      },
      {
        name: "Critic",
        role: "Critical Reviewer",
        description: "Challenges assumptions, finds flaws, plays devil's advocate.",
        provider: "codex",
        model: "o3",
        systemPrompt: "You are the Critic / Devil's Advocate. Your role:\n- Challenge every assumption and proposal\n- Find flaws, risks, and edge cases\n- Question whether the proposed solution is truly the best\n- Identify what could go wrong\nBe constructively critical. Your skepticism prevents costly mistakes.",
        order: 2,
        tier: 1,
      },
      {
        name: "Innovator",
        role: "Creative Problem Solver",
        description: "Proposes creative alternatives, thinks outside the box.",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "You are the Innovator / Creative Problem Solver. Your role:\n- Propose creative and unconventional solutions\n- Think about approaches others might miss\n- Draw inspiration from different domains\n- Challenge the status quo with fresh ideas\nDon't be constrained by 'how things are usually done'.",
        order: 3,
        tier: 1,
      },
      {
        name: "Pragmatist",
        role: "Implementation Advisor",
        description: "Evaluates feasibility, estimates effort, recommends the practical path.",
        provider: "codex",
        model: "gpt-4.1",
        systemPrompt: "You are the Pragmatist / Implementation Advisor. Your role:\n- Evaluate the feasibility of proposed solutions\n- Consider implementation complexity and maintenance burden\n- Recommend the most practical approach\n- Balance ideal solutions with real-world constraints\nWhat matters is what ships. Perfect is the enemy of good.",
        order: 4,
        tier: 1,
      },
    ],
  },
];
