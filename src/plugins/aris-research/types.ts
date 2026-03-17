/**
 * ARIS Research Plugin - Type Definitions
 *
 * Types for the Auto-claude-code-research-in-sleep (ARIS) plugin,
 * which provides 27 Claude Code skills for autonomous ML research pipelines.
 */

/** Skill category classification */
export type SkillCategory = "workflow" | "research" | "experiment" | "paper" | "utility";

/** A single ARIS skill definition */
export interface ArisSkill {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  command: string;
  category: SkillCategory;
  tier: number;
  dependencies?: string[];
  params?: ArisParam[];
}

/** Parameter input type */
export type ArisParamType = "text" | "number" | "select" | "boolean" | "textarea";

/** Parameter for an ARIS skill */
export interface ArisParam {
  name: string;
  default: string;
  description: string;
  type?: ArisParamType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

/** ARIS plugin configuration */
export interface ArisConfig {
  reviewerModel: string;
  reviewerProvider: "codex-mcp" | "llm-chat-mcp" | "minimax-mcp";
  autoProceed: boolean;
  humanCheckpoint: boolean;
  maxRounds: number;
  pilotMaxHours: number;
  maxTotalGpuHours: number;
  venue: "ICLR" | "NeurIPS" | "ICML" | "AAAI" | "ACL";
  feishuWebhook?: string;
}

/** Status of a node in a running pipeline */
export type NodeStatus = "idle" | "queued" | "running" | "done" | "error" | "skipped";

/** A node in a pipeline (wraps a skill reference + position) */
export interface PipelineNode {
  id: string;
  skillId: string;
  position: { x: number; y: number };
  status: NodeStatus;
  paramValues: Record<string, string>;
  notes: string;
}

/** An edge between pipeline nodes */
export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/** Attachment in a research program */
export interface ProgramAttachment {
  id: string;
  name: string;
  type: "file" | "link" | "image";
  url: string;
  mimeType?: string;
  addedAt: string;
}

/** Research program context (the "program.md" concept) */
export interface ResearchProgram {
  brief: string;
  attachments: ProgramAttachment[];
  templateId: string | null;
}

/** A saved pipeline */
export interface Pipeline {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  program: ResearchProgram;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Runtime state of a research workflow */
export interface ResearchState {
  currentWorkflow: string | null;
  currentRound: number;
  maxRounds: number;
  score: number | null;
  status: "idle" | "running" | "paused" | "completed" | "error";
  startedAt: string | null;
  lastUpdate: string | null;
  outputs: string[];
}
