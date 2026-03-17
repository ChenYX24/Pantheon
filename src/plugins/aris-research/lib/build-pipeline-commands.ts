/**
 * Build ordered pipeline commands via topological sort
 */
import type { Pipeline, PipelineNode, PipelineEdge, ArisSkill, ArisParam, SkillCategory } from "../types";
import { ARIS_SKILLS } from "../skill-data";

/** Result of building a command with workspace context */
export interface BuildCommandResult {
  command: string;        // the /skill-name args
  stageContext: string;   // description of what upstream stages produce
  outputDir: string;      // where this skill should write outputs (relative)
}

/** Map skill category to its conventional output directory */
const CATEGORY_OUTPUT_DIR: Record<SkillCategory, string> = {
  research: "agent-docs/knowledge/",
  workflow: "agent-docs/plan/",
  experiment: "experiments/",
  paper: "paper/",
  utility: "agent-docs/",
};

/** Map skill category to a human-readable description of its outputs */
const CATEGORY_OUTPUT_DESCRIPTION: Record<SkillCategory, string> = {
  research: "literature reviews, idea lists, novelty reports, and analysis in agent-docs/knowledge/",
  workflow: "pipeline plans and orchestration notes in agent-docs/plan/",
  experiment: "experiment scripts, configs, and results in experiments/",
  paper: "paper drafts, figures, and LaTeX files in paper/",
  utility: "utility outputs and logs in agent-docs/",
};

/** Build the command string from skill + param values */
export function buildCommand(skill: ArisSkill, values: Record<string, string>): string {
  const params = skill.params ?? [];
  const parts: string[] = [skill.command];

  for (const param of params) {
    const val = values[param.name] || param.default;
    if (!val) continue;
    if (val.includes(" ") || val.includes(",")) {
      parts.push(`"${val}"`);
    } else {
      parts.push(val);
    }
  }

  return parts.join(" ");
}

/** Build command with workspace-aware context */
export function buildCommandWithContext(
  skill: ArisSkill,
  values: Record<string, string>,
  upstreamSkills?: ArisSkill[]
): BuildCommandResult {
  const command = buildCommand(skill, values);
  const outputDir = CATEGORY_OUTPUT_DIR[skill.category] ?? "agent-docs/";

  // Build stage context from upstream skills
  let stageContext = "";
  if (upstreamSkills && upstreamSkills.length > 0) {
    const lines = upstreamSkills.map((us) => {
      const desc = CATEGORY_OUTPUT_DESCRIPTION[us.category] ?? "outputs in agent-docs/";
      return `- ${us.name}: produces ${desc}`;
    });
    stageContext = lines.join("\n");
  }

  return { command, stageContext, outputDir };
}

/** Check if all required params are filled */
export function getValidationErrors(skill: ArisSkill, values: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const param of skill.params ?? []) {
    if (param.required && !values[param.name] && !param.default) {
      errors.push(param.name);
    }
  }
  return errors;
}

/** Topological sort of pipeline nodes */
function topoSort(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const nodeMap = new Map<string, PipelineNode>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
    nodeMap.set(n.id, n);
  }

  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    adj.get(e.source)?.push(e.target);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: PipelineNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  return sorted;
}

/** Build ordered commands for a pipeline (with optional workspace context) */
export function buildPipelineCommands(
  pipeline: Pipeline
): { nodeId: string; skillId: string; command: string; skillName: string; stageContext: string; outputDir: string }[] {
  const sorted = topoSort(pipeline.nodes, pipeline.edges);

  // Build adjacency map: target -> source nodes (for upstream lookup)
  const incomingMap = new Map<string, string[]>();
  for (const e of pipeline.edges) {
    const existing = incomingMap.get(e.target) ?? [];
    existing.push(e.source);
    incomingMap.set(e.target, existing);
  }

  // Map nodeId -> skill for upstream resolution
  const nodeSkillMap = new Map<string, ArisSkill>();
  for (const node of pipeline.nodes) {
    const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
    if (skill) nodeSkillMap.set(node.id, skill);
  }

  return sorted.map((node) => {
    const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
    if (!skill) {
      return {
        nodeId: node.id,
        skillId: node.skillId,
        command: `# Unknown skill: ${node.skillId}`,
        skillName: node.skillId,
        stageContext: "",
        outputDir: "agent-docs/",
      };
    }

    // Resolve upstream skills from incoming edges
    const upstreamNodeIds = incomingMap.get(node.id) ?? [];
    const upstreamSkills = upstreamNodeIds
      .map((nid) => nodeSkillMap.get(nid))
      .filter((s): s is ArisSkill => !!s);

    const result = buildCommandWithContext(skill, node.paramValues, upstreamSkills);

    return {
      nodeId: node.id,
      skillId: node.skillId,
      command: result.command,
      skillName: skill.name,
      stageContext: result.stageContext,
      outputDir: result.outputDir,
    };
  });
}
