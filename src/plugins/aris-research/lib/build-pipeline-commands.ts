/**
 * Build ordered pipeline commands via topological sort
 */
import type { Pipeline, PipelineNode, PipelineEdge, ArisSkill, ArisParam } from "../types";
import { ARIS_SKILLS } from "../skill-data";

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

/** Build ordered commands for a pipeline */
export function buildPipelineCommands(
  pipeline: Pipeline
): { nodeId: string; skillId: string; command: string; skillName: string }[] {
  const sorted = topoSort(pipeline.nodes, pipeline.edges);
  return sorted.map((node) => {
    const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
    if (!skill) {
      return { nodeId: node.id, skillId: node.skillId, command: `# Unknown skill: ${node.skillId}`, skillName: node.skillId };
    }
    return {
      nodeId: node.id,
      skillId: node.skillId,
      command: buildCommand(skill, node.paramValues),
      skillName: skill.name,
    };
  });
}
