/**
 * Auto-layout team member nodes using dagre
 */
import dagre from "dagre";
import type { TeamMember, TeamEdge, TeamMemberNode } from "../types";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;

export function autoLayoutTeam(
  members: TeamMember[],
  edges: TeamEdge[],
  direction: "TB" | "LR" = "TB"
): TeamMemberNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 50 });

  for (const member of members) {
    g.setNode(member.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return members.map((member) => {
    const pos = g.node(member.id);
    return {
      memberId: member.id,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

export { NODE_WIDTH, NODE_HEIGHT };
