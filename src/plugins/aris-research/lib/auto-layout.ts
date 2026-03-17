/**
 * Auto-layout pipeline nodes using dagre
 */
import dagre from "dagre";
import type { PipelineNode, PipelineEdge } from "../types";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 80;

export function autoLayout(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  direction: "TB" | "LR" = "TB"
): PipelineNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 50 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

export { NODE_WIDTH, NODE_HEIGHT };
