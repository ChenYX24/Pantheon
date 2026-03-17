/**
 * Layout presets for team canvas visualisation
 *
 * Generates dagre-based layouts tailored to each preset template.
 */
import { autoLayoutTeam } from "./team-auto-layout";
import type { AgentTeam, TeamCanvasData, TeamEdge } from "../types";

interface LayoutHints {
  direction: "TB" | "LR";
  rankSep: number;
  nodeSep: number;
}

const PRESET_HINTS: Record<string, LayoutHints> = {
  "san-sheng-liu-bu": { direction: "TB", rankSep: 100, nodeSep: 60 },
  "pair-programming": { direction: "LR", rankSep: 80, nodeSep: 50 },
  "tdd-squad": { direction: "LR", rankSep: 80, nodeSep: 50 },
  "full-stack-team": { direction: "TB", rankSep: 80, nodeSep: 50 },
  "research-analysis": { direction: "LR", rankSep: 80, nodeSep: 50 },
};

const DEFAULT_HINTS: LayoutHints = { direction: "TB", rankSep: 80, nodeSep: 50 };

/** Get preset-specific layout hints */
export function getPresetLayoutHints(presetId: string): LayoutHints {
  return PRESET_HINTS[presetId] ?? DEFAULT_HINTS;
}

/**
 * Build edict-style edges for 三省六部 preset:
 * 太子 → 中书省 → 门下省 → 尚书省 → 六部 (fan-out)
 * 门下省 --封驳--> 中书省 (reject/review loop)
 */
function buildSanShengEdges(members: AgentTeam["members"]): TeamEdge[] {
  const edges: TeamEdge[] = [];
  const byOrder = [...members].sort((a, b) => a.order - b.order);

  // Find key members by order: 1=太子, 2=中书, 3=门下, 4=尚书, 5+=六部
  const taizi = byOrder.find((m) => m.order === 1);
  const zhongshu = byOrder.find((m) => m.order === 2);
  const menxia = byOrder.find((m) => m.order === 3);
  const shangshu = byOrder.find((m) => m.order === 4);
  const liubu = byOrder.filter((m) => m.order >= 5);

  if (taizi && zhongshu) {
    edges.push({ id: `e-taizi-zhongshu`, source: taizi.id, target: zhongshu.id, type: "data", label: "dispatch" });
  }
  if (zhongshu && menxia) {
    edges.push({ id: `e-zhongshu-menxia`, source: zhongshu.id, target: menxia.id, type: "data", label: "submit" });
  }
  if (menxia && zhongshu) {
    // Reject loop (封驳)
    edges.push({ id: `e-menxia-zhongshu`, source: menxia.id, target: zhongshu.id, type: "review", label: "reject" });
  }
  if (menxia && shangshu) {
    edges.push({ id: `e-menxia-shangshu`, source: menxia.id, target: shangshu.id, type: "control", label: "approve" });
  }
  // Fan-out from 尚书省 to all 六部
  if (shangshu) {
    for (const ministry of liubu) {
      edges.push({ id: `e-shangshu-${ministry.id}`, source: shangshu.id, target: ministry.id, type: "control" });
    }
  }
  // All 六部 report back to 尚书省
  if (shangshu) {
    for (const ministry of liubu) {
      edges.push({ id: `e-${ministry.id}-shangshu`, source: ministry.id, target: shangshu.id, type: "data", label: "report" });
    }
  }

  return edges;
}

/**
 * Build edges from the member hierarchy (parentId / tier / order).
 * For hierarchical teams: parent -> child edges (control type).
 * For sequential teams: chain in order (data type).
 * For parallel teams: no edges between same-tier members.
 */
function buildEdgesFromMembers(team: AgentTeam): TeamEdge[] {
  // Special case: 三省六部 uses edict-style directed flow
  const presetId = team.presetId ?? team.id;
  if (presetId === "san-sheng-liu-bu") {
    return buildSanShengEdges(team.members);
  }

  const edges: TeamEdge[] = [];
  const members = team.members;

  if (team.workflow === "hierarchical") {
    // Build parent -> child edges from parentId or tier structure
    for (const member of members) {
      if (member.parentId) {
        edges.push({
          id: `edge-${member.parentId}-${member.id}`,
          source: member.parentId,
          target: member.id,
          type: "control",
        });
      }
    }
    // If no parentId edges found, infer from tier hierarchy
    if (edges.length === 0) {
      const byTier = new Map<number, typeof members>();
      for (const m of members) {
        const list = byTier.get(m.tier) ?? [];
        list.push(m);
        byTier.set(m.tier, list);
      }
      const tiers = [...byTier.keys()].sort((a, b) => a - b);
      for (let i = 0; i < tiers.length - 1; i++) {
        const parents = byTier.get(tiers[i])!;
        const children = byTier.get(tiers[i + 1])!;
        for (const parent of parents) {
          for (const child of children) {
            edges.push({
              id: `edge-${parent.id}-${child.id}`,
              source: parent.id,
              target: child.id,
              type: "control",
            });
          }
        }
      }
    }
  } else if (team.workflow === "sequential") {
    const sorted = [...members].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length - 1; i++) {
      edges.push({
        id: `edge-${sorted[i].id}-${sorted[i + 1].id}`,
        source: sorted[i].id,
        target: sorted[i + 1].id,
        type: "data",
      });
    }
  }
  // parallel: no automatic edges

  return edges;
}

/** Generate canvas data for a team based on its preset */
export function generatePresetLayout(team: AgentTeam): TeamCanvasData {
  const presetId = team.presetId ?? team.id;
  const hints = getPresetLayoutHints(presetId);
  const edges = buildEdgesFromMembers(team);

  const memberPositions = autoLayoutTeam(team.members, edges, hints.direction);

  return {
    memberPositions,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
