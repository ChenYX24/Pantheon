/**
 * Pre-built pipeline templates
 */
import type { Pipeline, PipelineNode, PipelineEdge } from "./types";
import { autoLayout } from "./lib/auto-layout";

function makeNode(id: string, skillId: string): PipelineNode {
  return { id, skillId, position: { x: 0, y: 0 }, status: "idle", paramValues: {}, notes: "" };
}

function makeEdge(source: string, target: string): PipelineEdge {
  return { id: `${source}-${target}`, source, target };
}

function buildTemplate(
  id: string,
  name: string,
  nameZh: string,
  desc: string,
  descZh: string,
  brief: string,
  nodes: PipelineNode[],
  edges: PipelineEdge[]
): Pipeline {
  const laid = autoLayout(nodes, edges);
  return {
    id,
    name,
    nameZh,
    description: desc,
    descriptionZh: descZh,
    nodes: laid,
    edges,
    program: { brief, attachments: [], templateId: id },
    isTemplate: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const IDEA_DISCOVERY = buildTemplate(
  "tpl-idea-discovery",
  "Idea Discovery",
  "想法发现流水线",
  "Literature → Brainstorm → Novelty Check → Review → Refine",
  "文献调研 → 头脑风暴 → 新颖性检查 → 评审 → 优化",
  `# Research Direction\n\nDescribe your research topic here...\n\n## Background\n\n## Key Questions\n\n## Constraints\n- Target venue: \n- GPU budget: \n`,
  [
    makeNode("n1", "research-lit"),
    makeNode("n2", "idea-creator"),
    makeNode("n3", "novelty-check"),
    makeNode("n4", "research-review"),
    makeNode("n5", "research-refine"),
  ],
  [
    makeEdge("n1", "n2"),
    makeEdge("n2", "n3"),
    makeEdge("n3", "n4"),
    makeEdge("n4", "n5"),
  ]
);

const AUTO_REVIEW = buildTemplate(
  "tpl-auto-review",
  "Auto Review Loop",
  "自动评审循环",
  "Multi-round review → fix → re-review cycle",
  "多轮评审 → 修复 → 重评循环",
  `# Review Target\n\nWhat are you reviewing?\n\n## Current Status\n\n## Success Criteria\n- Target score: >= 6/10\n- Max rounds: 4\n`,
  [
    makeNode("n1", "research-review"),
    makeNode("n2", "research-refine"),
    makeNode("n3", "experiment-plan"),
  ],
  [
    makeEdge("n1", "n2"),
    makeEdge("n2", "n3"),
  ]
);

const PAPER_WRITING = buildTemplate(
  "tpl-paper-writing",
  "Paper Writing",
  "论文写作流水线",
  "Plan → Figures → Write → Compile → Improve",
  "规划 → 图表 → 撰写 → 编译 → 改进",
  `# Paper Plan\n\n## Core Claims\n1. \n2. \n\n## Target Venue\n\n## Experiment Results Location\n\n## Key References\n`,
  [
    makeNode("n1", "paper-plan"),
    makeNode("n2", "paper-figure"),
    makeNode("n3", "paper-write"),
    makeNode("n4", "paper-compile"),
    makeNode("n5", "auto-paper-improvement-loop"),
  ],
  [
    makeEdge("n1", "n2"),
    makeEdge("n1", "n3"),
    makeEdge("n2", "n3"),
    makeEdge("n3", "n4"),
    makeEdge("n4", "n5"),
  ]
);

const RESEARCH_PIPELINE = buildTemplate(
  "tpl-research-pipeline",
  "Full Research Pipeline",
  "完整研究流水线",
  "Idea Discovery → Experiment → Review → Paper",
  "想法发现 → 实验 → 评审 → 论文",
  `# Research Program\n\n## Direction\n\n## Hypothesis\n\n## Key References\n- \n\n## Constraints\n- Target venue: ICLR\n- GPU budget: 24h\n- Timeline: \n\n## My Thoughts\n\n`,
  [
    makeNode("n1", "research-lit"),
    makeNode("n2", "idea-creator"),
    makeNode("n3", "novelty-check"),
    makeNode("n4", "research-review"),
    makeNode("n5", "research-refine"),
    makeNode("n6", "experiment-plan"),
    makeNode("n7", "run-experiment"),
    makeNode("n8", "monitor-experiment"),
    makeNode("n9", "analyze-results"),
    makeNode("n10", "paper-plan"),
    makeNode("n11", "paper-figure"),
    makeNode("n12", "paper-write"),
    makeNode("n13", "paper-compile"),
  ],
  [
    makeEdge("n1", "n2"),
    makeEdge("n2", "n3"),
    makeEdge("n3", "n4"),
    makeEdge("n4", "n5"),
    makeEdge("n5", "n6"),
    makeEdge("n6", "n7"),
    makeEdge("n7", "n8"),
    makeEdge("n8", "n9"),
    makeEdge("n9", "n10"),
    makeEdge("n10", "n11"),
    makeEdge("n10", "n12"),
    makeEdge("n11", "n12"),
    makeEdge("n12", "n13"),
  ]
);

export const PIPELINE_TEMPLATES: Pipeline[] = [
  IDEA_DISCOVERY,
  AUTO_REVIEW,
  PAPER_WRITING,
  RESEARCH_PIPELINE,
];
