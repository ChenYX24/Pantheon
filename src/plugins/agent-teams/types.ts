/**
 * Agent Teams Plugin - Type Definitions
 *
 * Defines the data model for agent teams where each member
 * can use a different provider/model/API key combination.
 */

/** Workflow orchestration mode */
export type WorkflowMode = "sequential" | "parallel" | "hierarchical";

/** Provider source for a team member */
export type MemberProvider = "claude" | "codex" | "api";

/** A single team member (agent) */
export interface TeamMember {
  id: string;
  name: string;
  role: string;
  description: string;
  provider: MemberProvider;
  model: string;
  apiKeyId?: string;
  systemPrompt: string;
  tools?: string[];
  /** Execution order (lower = first) */
  order: number;
  /** For hierarchical mode: parent member id */
  parentId?: string;
  /** Member tier/rank (1 = top, 5 = bottom) */
  tier: number;
}

/** An agent team configuration */
export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  icon: string;
  workflow: WorkflowMode;
  members: TeamMember[];
  created_at: string;
  updated_at: string;
  /** Is this a built-in preset (non-deletable) */
  isPreset?: boolean;
  /** Preset template ID if cloned from a preset */
  presetId?: string;
  /** Tags for filtering */
  tags: string[];
  /** Visual workflow canvas data */
  canvas?: TeamCanvasData;
}

/** Preset template for creating teams */
export interface TeamPreset {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  icon: string;
  workflow: WorkflowMode;
  members: Omit<TeamMember, "id">[];
  tags: string[];
}

/** Model option for the member config */
export interface ModelOption {
  value: string;
  label: string;
  provider: MemberProvider;
  group: string;
}

/** API key option from the key store */
export interface ApiKeyOption {
  id: string;
  name: string;
  provider: string;
  key_masked: string;
}

// ---- Visual Workflow Types (v4.0) ----

/** Position on the React Flow canvas */
export interface NodePosition {
  x: number;
  y: number;
}

/** A member node on the team canvas (extends TeamMember with position) */
export interface TeamMemberNode {
  memberId: string;
  position: NodePosition;
}

/** Edge between members in the workflow */
export interface TeamEdge {
  id: string;
  source: string; // member ID
  target: string; // member ID
  type: "data" | "control" | "review";
  label?: string;
}

/** Canvas layout data for a team */
export interface TeamCanvasData {
  memberPositions: TeamMemberNode[];
  edges: TeamEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

/** Execution status for a team run */
export type TeamNodeStatus = "idle" | "queued" | "running" | "done" | "error" | "skipped";

/** Execution run record */
export interface TeamRun {
  id: string;
  teamId: string;
  status: "running" | "completed" | "error" | "aborted";
  nodeStatuses: Record<string, TeamNodeStatus>;
  logs: string[];
  startedAt: string;
  completedAt?: string;
  totalTokens?: number;
  totalCost?: number;
}
