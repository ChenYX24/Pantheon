/**
 * Research Pipeline Stages — the core mental model
 *
 * Each stage defines WHAT to do, WHY, which skills help, and what inputs/outputs are expected.
 */

export interface StageSkillRef {
  skillId: string;
  role: string;       // What this skill does in this stage
  roleZh: string;
  optional?: boolean;
  isWorkflow?: boolean;  // One-click workflow skill that covers this entire stage
}

export interface StageInput {
  name: string;
  nameZh: string;
  type: "text" | "file" | "link" | "image";
  description: string;
  descriptionZh: string;
  required?: boolean;
  placeholder?: string;
}

export interface StageOutput {
  name: string;
  nameZh: string;
  file: string;       // Expected output filename
  description: string;
  descriptionZh: string;
}

export type StageStatus = "locked" | "available" | "in-progress" | "done" | "skipped";

export interface ResearchStage {
  id: string;
  number: number;
  name: string;
  nameZh: string;
  goal: string;
  goalZh: string;
  description: string;
  descriptionZh: string;
  icon: string;        // lucide icon name
  color: string;       // tailwind color class
  skills: StageSkillRef[];
  inputs: StageInput[];
  outputs: StageOutput[];
  tips: string[];
  tipsZh: string[];
}

export const RESEARCH_STAGES: ResearchStage[] = [
  {
    id: "literature",
    number: 1,
    name: "Literature & Ideation",
    nameZh: "选题与文献调研",
    goal: "Find a valuable research direction with novelty potential",
    goalZh: "找到有价值且具有新颖性的研究方向",
    description: "Survey the literature, identify gaps, and brainstorm concrete research ideas. Start broad, then narrow down.",
    descriptionZh: "调研文献、发现空白、头脑风暴具体研究想法。从宽泛到聚焦。",
    icon: "BookOpen",
    color: "amber",
    skills: [
      { skillId: "idea-discovery", role: "One-click: literature → brainstorm → novelty → review → refine", roleZh: "一键运行：文献 → 头脑风暴 → 新颖性 → 评审 → 优化", isWorkflow: true },
      { skillId: "research-lit", role: "Multi-source literature search", roleZh: "多源文献检索" },
      { skillId: "idea-creator", role: "Generate 8-12 research ideas via LLM", roleZh: "通过 LLM 生成 8-12 个研究想法" },
    ],
    inputs: [
      { name: "Research direction", nameZh: "研究方向", type: "text", description: "1-2 sentences of your initial interest", descriptionZh: "1-2 句话描述你的初步兴趣", required: true, placeholder: "e.g. fine-grained visual recognition with VLMs" },
      { name: "Reference papers", nameZh: "参考论文", type: "link", description: "Key papers you've already read", descriptionZh: "你已经读过的关键论文", placeholder: "https://arxiv.org/abs/..." },
      { name: "Background data", nameZh: "背景数据", type: "file", description: "Relevant datasets or prior results", descriptionZh: "相关数据集或之前的结果" },
      { name: "Your thoughts", nameZh: "你的思考", type: "text", description: "Intuitions, constraints, what you find interesting", descriptionZh: "你的直觉、约束条件、感兴趣的点" },
    ],
    outputs: [
      { name: "Literature Summary", nameZh: "文献综述", file: "LITERATURE_SURVEY.md", description: "Landscape map + gap analysis", descriptionZh: "研究全景图 + 空白分析" },
      { name: "Idea Report", nameZh: "想法报告", file: "IDEA_REPORT.md", description: "Ranked ideas with pilot signals", descriptionZh: "按优先级排列的想法及试点信号" },
    ],
    tips: [
      "Cast a wide net first — search across arXiv, Scholar, and local PDFs",
      "Look for 2-3 related but non-overlapping papers as anchors",
      "Pilot experiments help distinguish promising ideas from dead ends",
    ],
    tipsZh: [
      "先广泛搜索 —— 跨 arXiv、Scholar 和本地 PDF",
      "找 2-3 篇相关但不重叠的论文作为锚点",
      "试点实验帮你区分有潜力的想法和死胡同",
    ],
  },
  {
    id: "validation",
    number: 2,
    name: "Validation & Screening",
    nameZh: "想法验证与筛选",
    goal: "Confirm novelty and feasibility of top ideas",
    goalZh: "确认 top idea 的新颖性和可行性",
    description: "Check if your ideas are truly novel (no one else has done it), get expert-level review feedback, and select the strongest idea to pursue.",
    descriptionZh: "检查你的想法是否真正新颖（没有人做过），获取专家级评审反馈，选择最强的想法去推进。",
    icon: "ShieldCheck",
    color: "blue",
    skills: [
      { skillId: "idea-discovery", role: "One-click: covers Stage 1+2 (literature → validate)", roleZh: "一键运行：覆盖阶段 1+2（文献 → 验证）", isWorkflow: true },
      { skillId: "novelty-check", role: "Verify novelty against recent literature", roleZh: "对比近期文献验证新颖性" },
      { skillId: "research-review", role: "Get critical review from external LLM", roleZh: "从外部 LLM 获取批判性评审" },
    ],
    inputs: [
      { name: "Top ideas", nameZh: "候选想法", type: "text", description: "Ideas from Stage 1 to validate", descriptionZh: "第 1 阶段产出的待验证想法", required: true },
      { name: "Additional context", nameZh: "补充背景", type: "text", description: "Why you think this idea is promising", descriptionZh: "你为什么觉得这个想法有潜力" },
    ],
    outputs: [
      { name: "Novelty Assessment", nameZh: "新颖性评估", file: "NOVELTY_REPORT.md", description: "Novelty score + closest prior work", descriptionZh: "新颖性评分 + 最接近的已有工作" },
      { name: "Review Feedback", nameZh: "评审反馈", file: "REVIEW_FEEDBACK.md", description: "Structured score + weaknesses + suggestions", descriptionZh: "结构化评分 + 不足 + 建议" },
    ],
    tips: [
      "If novelty check finds very similar work, pivot rather than forcing it",
      "Review feedback is gold — address the weaknesses before moving forward",
      "It's OK to loop back to Stage 1 if no idea survives validation",
    ],
    tipsZh: [
      "如果新颖性检查发现非常相似的工作，转向而非强行推进",
      "评审反馈是金子 —— 在继续之前解决不足",
      "如果没有想法通过验证，回到第 1 阶段是完全可以的",
    ],
  },
  {
    id: "method",
    number: 3,
    name: "Method Design",
    nameZh: "方法设计与优化",
    goal: "Turn the validated idea into an executable method with experiment plan",
    goalZh: "把验证过的想法变成可执行的方法和实验计划",
    description: "Iteratively refine your method through LLM-powered review cycles. Freeze the problem anchor, design the approach, and create a detailed experiment plan with claims to verify.",
    descriptionZh: "通过 LLM 驱动的评审循环迭代优化你的方法。冻结问题锚点，设计方法，创建详细的实验计划和要验证的论点。",
    icon: "Cpu",
    color: "violet",
    skills: [
      { skillId: "research-refine-pipeline", role: "One-click: refine method + generate experiment plan", roleZh: "一键运行：优化方法 + 生成实验计划", isWorkflow: true },
      { skillId: "research-refine", role: "Iterative method refinement (up to 5 rounds)", roleZh: "迭代方法优化（最多 5 轮）" },
      { skillId: "experiment-plan", role: "Claim-driven experiment roadmap", roleZh: "论点驱动的实验路线图" },
    ],
    inputs: [
      { name: "Validated idea", nameZh: "验证过的想法", type: "text", description: "The idea that passed Stage 2", descriptionZh: "通过第 2 阶段的想法", required: true },
      { name: "Review feedback", nameZh: "评审反馈", type: "text", description: "Weaknesses to address from review", descriptionZh: "需要解决的评审不足" },
      { name: "Architecture sketch", nameZh: "架构草图", type: "image", description: "Diagram of your proposed method", descriptionZh: "你提出方法的示意图" },
      { name: "Code repo", nameZh: "代码仓库", type: "link", description: "GitHub link to your codebase", descriptionZh: "代码库的 GitHub 链接" },
    ],
    outputs: [
      { name: "Final Proposal", nameZh: "最终方案", file: "refine-logs/FINAL_PROPOSAL.md", description: "Problem anchor + refined method thesis", descriptionZh: "问题锚点 + 优化后的方法论述" },
      { name: "Experiment Plan", nameZh: "实验计划", file: "refine-logs/EXPERIMENT_PLAN.md", description: "Claims, ablations, run order, budget", descriptionZh: "论点、消融实验、运行顺序、预算" },
    ],
    tips: [
      "Keep your method simple — elegance beats complexity at top venues",
      "Freeze the problem anchor early to avoid scope drift",
      "Each claim in the experiment plan must have a falsifiable experiment",
    ],
    tipsZh: [
      "保持方法简洁 —— 在顶会中，优雅胜过复杂",
      "尽早冻结问题锚点，避免范围蔓延",
      "实验计划中的每个论点必须有可证伪的实验",
    ],
  },
  {
    id: "experiment",
    number: 4,
    name: "Experiment Execution",
    nameZh: "实验执行",
    goal: "Run experiments on GPU and collect results",
    goalZh: "在 GPU 上跑实验并收集结果",
    description: "Deploy your experiments to remote GPU servers, monitor training progress, collect results, and analyze them statistically.",
    descriptionZh: "将实验部署到远程 GPU 服务器，监控训练进度，收集结果，进行统计分析。",
    icon: "Zap",
    color: "orange",
    skills: [
      { skillId: "run-experiment", role: "Deploy via SSH + screen to remote GPU", roleZh: "通过 SSH + screen 部署到远程 GPU" },
      { skillId: "monitor-experiment", role: "Check progress and collect results", roleZh: "检查进度和收集结果" },
      { skillId: "analyze-results", role: "Statistical analysis of results", roleZh: "结果的统计分析" },
    ],
    inputs: [
      { name: "Experiment script", nameZh: "实验脚本", type: "text", description: "Path to training script", descriptionZh: "训练脚本路径", required: true, placeholder: "/mnt/qiyun/code/cyx/train.py" },
      { name: "SSH host", nameZh: "SSH 服务器", type: "text", description: "Remote server to run on", descriptionZh: "运行的远程服务器", required: true, placeholder: "thu_lc_2_chenyuxuan_2222" },
      { name: "Dataset path", nameZh: "数据集路径", type: "text", description: "Path to training data", descriptionZh: "训练数据路径", placeholder: "/mnt/qiyun/data/" },
      { name: "Config/hyperparams", nameZh: "配置/超参", type: "file", description: "Config YAML or hyperparameter file", descriptionZh: "配置 YAML 或超参文件" },
    ],
    outputs: [
      { name: "Experiment Logs", nameZh: "实验日志", file: "logs/*.log", description: "Training logs with metrics", descriptionZh: "包含指标的训练日志" },
      { name: "Results", nameZh: "结果", file: "results.json", description: "Collected metrics and evaluation scores", descriptionZh: "收集的指标和评估分数" },
      { name: "Analysis Report", nameZh: "分析报告", file: "ANALYSIS_REPORT.md", description: "Statistical analysis and comparisons", descriptionZh: "统计分析和对比" },
    ],
    tips: [
      "Always check GPU availability before launching (nvidia-smi)",
      "Use screen sessions for persistent execution",
      "Save all logits/intermediate results — you'll need them for the paper",
    ],
    tipsZh: [
      "启动前总是先检查 GPU 可用性 (nvidia-smi)",
      "使用 screen 会话保证持久运行",
      "保存所有 logits/中间结果 —— 写论文时你会需要它们",
    ],
  },
  {
    id: "review",
    number: 5,
    name: "Review & Iteration",
    nameZh: "评审与迭代",
    goal: "Multi-round review-fix cycles until score >= 6/10",
    goalZh: "多轮评审-修复循环直到分数 >= 6/10",
    description: "Submit your work for automated critical review. Each round: get feedback, implement fixes, re-run experiments if needed, then re-submit. Stop when the reviewer says 'ready' or after max rounds.",
    descriptionZh: "提交你的工作进行自动批判性评审。每轮：获取反馈、实施修复、必要时重跑实验、然后重新提交。当评审说 ready 或达到最大轮数时停止。",
    icon: "RefreshCw",
    color: "cyan",
    skills: [
      { skillId: "auto-review-loop", role: "One-click: multi-round review → fix → re-review (Codex MCP)", roleZh: "一键运行：多轮评审 → 修复 → 重评 (Codex MCP)", isWorkflow: true },
      { skillId: "auto-review-loop-llm", role: "Alternative: generic LLM Chat MCP", roleZh: "替代方案：通用 LLM Chat MCP", optional: true },
      { skillId: "auto-review-loop-minimax", role: "Alternative: MiniMax MCP", roleZh: "替代方案：MiniMax MCP", optional: true },
    ],
    inputs: [
      { name: "Narrative report", nameZh: "叙述报告", type: "text", description: "Summary of your method + results", descriptionZh: "你的方法 + 结果摘要", required: true },
      { name: "Experiment results", nameZh: "实验结果", type: "file", description: "Results files from Stage 4", descriptionZh: "第 4 阶段的结果文件" },
      { name: "Target score", nameZh: "目标分数", type: "text", description: "Minimum review score to pass (default: 6)", descriptionZh: "通过的最低评审分数（默认：6）", placeholder: "6" },
    ],
    outputs: [
      { name: "Review History", nameZh: "评审历史", file: "AUTO_REVIEW.md", description: "All rounds: scores, feedback, fixes applied", descriptionZh: "所有轮次：分数、反馈、已实施的修复" },
      { name: "Final Score", nameZh: "最终分数", file: "REVIEW_STATE.json", description: "Final review score and verdict", descriptionZh: "最终评审分数和结论" },
    ],
    tips: [
      "Start with HUMAN_CHECKPOINT=true to review each round's suggestions",
      "Focus on CRITICAL issues first, MINOR issues can wait for the paper",
      "If score plateaus after 3 rounds, consider pivoting the method",
    ],
    tipsZh: [
      "先用 HUMAN_CHECKPOINT=true 审查每轮的建议",
      "先解决 CRITICAL 问题，MINOR 问题可以留到写论文时",
      "如果分数在 3 轮后停滞，考虑调整方法",
    ],
  },
  {
    id: "paper",
    number: 6,
    name: "Paper Writing",
    nameZh: "论文写作",
    goal: "Generate a submission-ready PDF",
    goalZh: "生成可投稿的 PDF",
    description: "Plan the paper structure, generate figures and tables from results, write LaTeX section by section, compile to PDF, then run automated improvement rounds for polish.",
    descriptionZh: "规划论文结构，从结果生成图表，逐章节撰写 LaTeX，编译为 PDF，然后运行自动改进轮次进行润色。",
    icon: "FileText",
    color: "green",
    skills: [
      { skillId: "paper-writing", role: "One-click: plan → figures → write → compile → improve", roleZh: "一键运行：规划 → 图表 → 撰写 → 编译 → 改进", isWorkflow: true },
      { skillId: "paper-plan", role: "Claims-evidence matrix + section planning", roleZh: "论点-证据矩阵 + 章节规划" },
      { skillId: "paper-figure", role: "Auto-generate plots and LaTeX tables", roleZh: "自动生成图表和 LaTeX 表格" },
      { skillId: "paper-write", role: "Section-by-section LaTeX with BibTeX", roleZh: "逐章节 LaTeX 撰写 + BibTeX" },
      { skillId: "paper-compile", role: "latexmk compilation with auto-fix", roleZh: "latexmk 编译 + 自动修复" },
      { skillId: "auto-paper-improvement-loop", role: "2-round review/polish cycle", roleZh: "2 轮评审/润色循环" },
      { skillId: "proof-writer", role: "Draft theorem proofs (if needed)", roleZh: "起草定理证明（如需）", optional: true },
    ],
    inputs: [
      { name: "All prior outputs", nameZh: "所有前序输出", type: "text", description: "Narrative, results, review history", descriptionZh: "叙述报告、结果、评审历史", required: true },
      { name: "Target venue", nameZh: "目标会议", type: "text", description: "Conference format to follow", descriptionZh: "遵循的会议格式", placeholder: "ICLR / NeurIPS / ICML" },
      { name: "Figure data", nameZh: "图表数据", type: "file", description: "CSV/JSON data for generating plots", descriptionZh: "用于生成图表的 CSV/JSON 数据" },
    ],
    outputs: [
      { name: "Paper Plan", nameZh: "论文计划", file: "PAPER_PLAN.md", description: "Section outline + claims-evidence matrix", descriptionZh: "章节大纲 + 论点-证据矩阵" },
      { name: "Figures", nameZh: "图表", file: "figures/", description: "Generated plots and tables", descriptionZh: "生成的图和表" },
      { name: "LaTeX Source", nameZh: "LaTeX 源码", file: "paper/main.tex", description: "Complete LaTeX with sections", descriptionZh: "包含所有章节的完整 LaTeX" },
      { name: "Final PDF", nameZh: "最终 PDF", file: "paper/main.pdf", description: "Submission-ready PDF", descriptionZh: "可投稿的 PDF" },
    ],
    tips: [
      "Let paper-plan create the structure before you start writing",
      "Generate figures BEFORE paper-write so they can be referenced",
      "The improvement loop catches issues like AI watch words and formatting",
    ],
    tipsZh: [
      "让 paper-plan 先创建结构再开始写",
      "在 paper-write 之前生成图表，这样可以被引用",
      "改进循环会捕获 AI 用词和格式问题",
    ],
  },
];

/** Stage color mapping for tailwind */
export const STAGE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  amber:  { bg: "bg-amber-500/10",  border: "border-amber-500/30",  text: "text-amber-600 dark:text-amber-400",  badge: "bg-amber-500" },
  blue:   { bg: "bg-blue-500/10",   border: "border-blue-500/30",   text: "text-blue-600 dark:text-blue-400",   badge: "bg-blue-500" },
  violet: { bg: "bg-violet-500/10", border: "border-violet-500/30", text: "text-violet-600 dark:text-violet-400", badge: "bg-violet-500" },
  orange: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-600 dark:text-orange-400", badge: "bg-orange-500" },
  cyan:   { bg: "bg-cyan-500/10",   border: "border-cyan-500/30",   text: "text-cyan-600 dark:text-cyan-400",   badge: "bg-cyan-500" },
  green:  { bg: "bg-green-500/10",  border: "border-green-500/30",  text: "text-green-600 dark:text-green-400",  badge: "bg-green-500" },
};
