/**
 * ARIS Research Plugin - Skill Data
 *
 * All 27 ARIS skills organized by category.
 * Reference: https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep
 */

import type { ArisSkill, SkillCategory } from "./types";

// ---- Workflow Skills (Tier 3 - Advanced) ----

const WORKFLOW_SKILLS: ArisSkill[] = [
  {
    id: "research-pipeline",
    name: "Research Pipeline",
    nameZh: "研究流水线",
    description: "End-to-end: idea -> experiment -> review (master orchestrator)",
    descriptionZh: "端到端：想法 -> 实验 -> 评审（主编排器）",
    command: "/research-pipeline",
    category: "workflow",
    tier: 3,
    dependencies: ["idea-discovery", "run-experiment", "auto-review-loop", "paper-writing"],
    params: [
      { name: "topic", default: "", description: "Research topic or field", type: "text", required: true, placeholder: "e.g. fine-grained visual recognition" },
      { name: "venue", default: "ICLR", description: "Target venue", type: "select", options: ["ICLR", "NeurIPS", "ICML", "AAAI", "ACL"] },
    ],
  },
  {
    id: "idea-discovery",
    name: "Idea Discovery",
    nameZh: "想法发现",
    description: "Literature survey -> brainstorm -> novelty check -> review -> refine",
    descriptionZh: "文献调研 -> 头脑风暴 -> 新颖性检查 -> 评审 -> 优化",
    command: "/idea-discovery",
    category: "workflow",
    tier: 3,
    dependencies: ["research-lit", "idea-creator", "novelty-check", "research-review"],
    params: [
      { name: "topic", default: "", description: "Research topic", type: "text", required: true, placeholder: "e.g. multimodal learning" },
      { name: "numIdeas", default: "10", description: "Number of ideas to generate", type: "number" },
    ],
  },
  {
    id: "auto-review-loop",
    name: "Auto Review Loop",
    nameZh: "自动评审循环",
    description: "Multi-round review-fix loop (target score >= 6/10, max 4 rounds)",
    descriptionZh: "多轮评审-修复循环（目标分数 >= 6/10，最多 4 轮）",
    command: "/auto-review-loop",
    category: "workflow",
    tier: 3,
    dependencies: ["research-review", "research-refine"],
    params: [
      { name: "targetScore", default: "6", description: "Minimum score to pass (out of 10)", type: "number" },
      { name: "maxRounds", default: "4", description: "Maximum review rounds", type: "number" },
    ],
  },
  {
    id: "paper-writing",
    name: "Paper Writing",
    nameZh: "论文写作",
    description: "Narrative report -> LaTeX paper -> PDF -> improvement loop",
    descriptionZh: "叙述报告 -> LaTeX 论文 -> PDF -> 改进循环",
    command: "/paper-writing",
    category: "workflow",
    tier: 3,
    dependencies: ["paper-plan", "paper-write", "paper-compile", "auto-paper-improvement-loop"],
    params: [
      { name: "venue", default: "ICLR", description: "Target venue format", type: "select", options: ["ICLR", "NeurIPS", "ICML", "AAAI", "ACL"] },
    ],
  },
  {
    id: "research-refine-pipeline",
    name: "Research Refine Pipeline",
    nameZh: "研究优化流水线",
    description: "Research refine + experiment plan chain",
    descriptionZh: "研究优化 + 实验计划链式执行",
    command: "/research-refine-pipeline",
    category: "workflow",
    tier: 3,
    dependencies: ["research-refine", "experiment-plan"],
    params: [
      { name: "topic", default: "", description: "Research topic", type: "text", required: true, placeholder: "e.g. efficient transformers" },
    ],
  },
  {
    id: "dse-loop",
    name: "DSE Loop",
    nameZh: "设计空间探索",
    description: "Design space exploration for architecture/EDA",
    descriptionZh: "架构/EDA 设计空间探索循环",
    command: "/dse-loop",
    category: "workflow",
    tier: 3,
    dependencies: ["run-experiment", "analyze-results"],
    params: [
      { name: "searchSpace", default: "", description: "Design space specification", type: "textarea", required: true, placeholder: "Define your parameter search space..." },
      { name: "metric", default: "accuracy", description: "Optimization metric", type: "text", placeholder: "e.g. accuracy, latency, throughput" },
    ],
  },
];

// ---- Research Skills (Tier 2 - Intermediate) ----

const RESEARCH_SKILLS: ArisSkill[] = [
  {
    id: "research-lit",
    name: "Literature Search",
    nameZh: "文献检索",
    description: "Multi-source literature search (Zotero, arXiv, Scholar, local PDFs)",
    descriptionZh: "多源文献检索（Zotero、arXiv、Scholar、本地 PDF）",
    command: "/research-lit",
    category: "research",
    tier: 2,
    params: [
      { name: "query", default: "", description: "Search query", type: "text", required: true, placeholder: "e.g. vision-language model fine-grained" },
      { name: "sources", default: "arxiv,scholar", description: "Comma-separated sources", type: "text", placeholder: "arxiv,scholar,zotero" },
    ],
  },
  {
    id: "idea-creator",
    name: "Idea Creator",
    nameZh: "想法生成器",
    description: "Generate 8-12 ideas via external LLM, filter, pilot experiments",
    descriptionZh: "通过外部 LLM 生成 8-12 个想法，过滤，试点实验",
    command: "/idea-creator",
    category: "research",
    tier: 2,
    dependencies: ["research-lit"],
    params: [
      { name: "topic", default: "", description: "Research topic", type: "text", required: true, placeholder: "e.g. contrastive learning" },
      { name: "count", default: "10", description: "Number of ideas to generate", type: "number" },
    ],
  },
  {
    id: "novelty-check",
    name: "Novelty Check",
    nameZh: "新颖性检查",
    description: "Multi-source novelty verification with cross-model validation",
    descriptionZh: "多源新颖性验证，跨模型交叉确认",
    command: "/novelty-check",
    category: "research",
    tier: 2,
    dependencies: ["research-lit"],
    params: [
      { name: "idea", default: "", description: "Idea description to check", type: "textarea", required: true, placeholder: "Describe the research idea to verify novelty..." },
    ],
  },
  {
    id: "research-review",
    name: "Research Review",
    nameZh: "研究评审",
    description: "External LLM critical review with structured scoring",
    descriptionZh: "外部 LLM 批判性评审，结构化评分",
    command: "/research-review",
    category: "research",
    tier: 2,
    params: [
      { name: "paperPath", default: "", description: "Path to paper/report", type: "text", required: true, placeholder: "/path/to/paper.pdf or report.md" },
    ],
  },
  {
    id: "research-refine",
    name: "Research Refine",
    nameZh: "研究优化",
    description: "Iterative method refinement with problem anchoring",
    descriptionZh: "迭代方法优化，锚定问题核心",
    command: "/research-refine",
    category: "research",
    tier: 2,
    dependencies: ["research-review"],
    params: [
      { name: "reviewFeedback", default: "", description: "Review feedback to address", type: "textarea", required: true, placeholder: "Paste review feedback or describe issues to address..." },
    ],
  },
  {
    id: "analyze-results",
    name: "Analyze Results",
    nameZh: "结果分析",
    description: "Statistical analysis of experiment results",
    descriptionZh: "实验结果统计分析",
    command: "/analyze-results",
    category: "research",
    tier: 2,
    params: [
      { name: "resultsPath", default: "", description: "Path to results directory", type: "text", required: true, placeholder: "/path/to/results/" },
    ],
  },
];

// ---- Experiment Skills (Tier 2 - Intermediate) ----

const EXPERIMENT_SKILLS: ArisSkill[] = [
  {
    id: "run-experiment",
    name: "Run Experiment",
    nameZh: "运行实验",
    description: "Deploy to remote GPU via SSH + screen/rsync",
    descriptionZh: "通过 SSH + screen/rsync 部署到远程 GPU",
    command: "/run-experiment",
    category: "experiment",
    tier: 2,
    params: [
      { name: "script", default: "", description: "Experiment script path", type: "text", required: true, placeholder: "/path/to/train.py" },
      { name: "host", default: "", description: "Remote SSH host", type: "select", options: ["thu_lc_2_chenyuxuan_2222", "thu_lc_2_chenyuxuan_2290", "thu_lc_chenyuxuan_2240", "AI4S", "AI4S_2_cyx"], placeholder: "Select SSH host" },
      { name: "gpus", default: "0", description: "GPU IDs to use", type: "text", placeholder: "0,1,2,3" },
    ],
  },
  {
    id: "monitor-experiment",
    name: "Monitor Experiment",
    nameZh: "监控实验",
    description: "Check running experiments, collect results",
    descriptionZh: "检查运行中的实验，收集结果",
    command: "/monitor-experiment",
    category: "experiment",
    tier: 2,
    dependencies: ["run-experiment"],
    params: [
      { name: "host", default: "", description: "Remote SSH host", type: "select", options: ["thu_lc_2_chenyuxuan_2222", "thu_lc_2_chenyuxuan_2290", "thu_lc_chenyuxuan_2240", "AI4S", "AI4S_2_cyx"], placeholder: "Select SSH host" },
    ],
  },
  {
    id: "experiment-plan",
    name: "Experiment Plan",
    nameZh: "实验计划",
    description: "Claim-driven experiment roadmap generation",
    descriptionZh: "基于论点驱动的实验路线图生成",
    command: "/experiment-plan",
    category: "experiment",
    tier: 2,
    params: [
      { name: "claims", default: "", description: "Paper claims to verify", type: "textarea", required: true, placeholder: "List the claims your paper makes..." },
    ],
  },
];

// ---- Paper Skills (Tier 2 - Intermediate) ----

const PAPER_SKILLS: ArisSkill[] = [
  {
    id: "paper-plan",
    name: "Paper Plan",
    nameZh: "论文规划",
    description: "Claims-evidence matrix and section planning",
    descriptionZh: "论点-证据矩阵和章节规划",
    command: "/paper-plan",
    category: "paper",
    tier: 2,
    params: [
      { name: "venue", default: "ICLR", description: "Target venue", type: "select", options: ["ICLR", "NeurIPS", "ICML", "AAAI", "ACL"] },
    ],
  },
  {
    id: "paper-figure",
    name: "Paper Figure",
    nameZh: "论文图表",
    description: "Auto-generate matplotlib/seaborn plots and LaTeX tables",
    descriptionZh: "自动生成 matplotlib/seaborn 图表和 LaTeX 表格",
    command: "/paper-figure",
    category: "paper",
    tier: 2,
    params: [
      { name: "dataPath", default: "", description: "Path to data for plotting", type: "text", required: true, placeholder: "/path/to/results.csv" },
      { name: "type", default: "plot", description: "Figure type", type: "select", options: ["plot", "table", "both"] },
    ],
  },
  {
    id: "paper-write",
    name: "Paper Write",
    nameZh: "论文撰写",
    description: "Section-by-section LaTeX with real BibTeX from DBLP/CrossRef",
    descriptionZh: "逐章节 LaTeX 撰写，从 DBLP/CrossRef 获取真实 BibTeX",
    command: "/paper-write",
    category: "paper",
    tier: 2,
    dependencies: ["paper-plan"],
    params: [
      { name: "section", default: "all", description: "Section to write", type: "select", options: ["all", "abstract", "introduction", "related-work", "method", "experiments", "conclusion"] },
    ],
  },
  {
    id: "paper-compile",
    name: "Paper Compile",
    nameZh: "论文编译",
    description: "latexmk compilation with auto-fix",
    descriptionZh: "latexmk 编译，自动修复错误",
    command: "/paper-compile",
    category: "paper",
    tier: 2,
    dependencies: ["paper-write"],
    params: [
      { name: "texFile", default: "main.tex", description: "Main tex file", type: "text", placeholder: "main.tex" },
    ],
  },
  {
    id: "auto-paper-improvement-loop",
    name: "Paper Improvement Loop",
    nameZh: "论文改进循环",
    description: "2-round paper review/polish cycle",
    descriptionZh: "2 轮论文评审/润色循环",
    command: "/auto-paper-improvement-loop",
    category: "paper",
    tier: 2,
    dependencies: ["paper-write", "research-review"],
    params: [
      { name: "rounds", default: "2", description: "Number of improvement rounds", type: "number" },
    ],
  },
  {
    id: "proof-writer",
    name: "Proof Writer",
    nameZh: "证明撰写",
    description: "Theorem/lemma drafting",
    descriptionZh: "定理/引理起草",
    command: "/proof-writer",
    category: "paper",
    tier: 2,
    params: [
      { name: "statement", default: "", description: "Theorem/lemma statement", type: "textarea", required: true, placeholder: "State the theorem or lemma to prove..." },
    ],
  },
];

// ---- Utility Skills (Tier 1 - Basic) ----

const UTILITY_SKILLS: ArisSkill[] = [
  {
    id: "feishu-notify",
    name: "Feishu Notify",
    nameZh: "飞书通知",
    description: "Feishu/Lark push notifications",
    descriptionZh: "飞书/Lark 推送通知",
    command: "/feishu-notify",
    category: "utility",
    tier: 1,
    params: [
      { name: "message", default: "", description: "Notification message", type: "text", required: true, placeholder: "Experiment finished!" },
      { name: "webhook", default: "", description: "Feishu webhook URL", type: "text", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/..." },
    ],
  },
  {
    id: "auto-review-loop-llm",
    name: "Review Loop (LLM Chat)",
    nameZh: "评审循环 (LLM Chat)",
    description: "Review loop variant using generic llm-chat MCP",
    descriptionZh: "使用通用 llm-chat MCP 的评审循环变体",
    command: "/auto-review-loop-llm",
    category: "utility",
    tier: 1,
    dependencies: ["auto-review-loop"],
    params: [
      { name: "targetScore", default: "6", description: "Minimum score", type: "number" },
      { name: "maxRounds", default: "4", description: "Maximum rounds", type: "number" },
    ],
  },
  {
    id: "auto-review-loop-minimax",
    name: "Review Loop (MiniMax)",
    nameZh: "评审循环 (MiniMax)",
    description: "Review loop variant for MiniMax",
    descriptionZh: "MiniMax 专用评审循环变体",
    command: "/auto-review-loop-minimax",
    category: "utility",
    tier: 1,
    dependencies: ["auto-review-loop"],
    params: [
      { name: "targetScore", default: "6", description: "Minimum score", type: "number" },
      { name: "maxRounds", default: "4", description: "Maximum rounds", type: "number" },
    ],
  },
];

/** All 27 ARIS skills */
export const ARIS_SKILLS: ArisSkill[] = [
  ...WORKFLOW_SKILLS,
  ...RESEARCH_SKILLS,
  ...EXPERIMENT_SKILLS,
  ...PAPER_SKILLS,
  ...UTILITY_SKILLS,
];

/** Skills grouped by category */
export const SKILLS_BY_CATEGORY: Record<SkillCategory, ArisSkill[]> = {
  workflow: WORKFLOW_SKILLS,
  research: RESEARCH_SKILLS,
  experiment: EXPERIMENT_SKILLS,
  paper: PAPER_SKILLS,
  utility: UTILITY_SKILLS,
};

/** Category metadata */
export const CATEGORY_META: Record<SkillCategory, { label: string; labelZh: string; count: number }> = {
  workflow: { label: "Workflows", labelZh: "工作流", count: WORKFLOW_SKILLS.length },
  research: { label: "Research", labelZh: "研究", count: RESEARCH_SKILLS.length },
  experiment: { label: "Experiment", labelZh: "实验", count: EXPERIMENT_SKILLS.length },
  paper: { label: "Paper", labelZh: "论文", count: PAPER_SKILLS.length },
  utility: { label: "Utility", labelZh: "工具", count: UTILITY_SKILLS.length },
};

/** The 3 main workflow quick-launch skills */
export const QUICK_LAUNCH_SKILLS: ArisSkill[] = [
  WORKFLOW_SKILLS.find((s) => s.id === "idea-discovery")!,
  WORKFLOW_SKILLS.find((s) => s.id === "auto-review-loop")!,
  WORKFLOW_SKILLS.find((s) => s.id === "paper-writing")!,
];
