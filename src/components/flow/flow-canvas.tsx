"use client";

import React, { memo, type ReactNode } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  onPaneClick?: () => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
  nodeTypes?: NodeTypes;
  fitView?: boolean;
  miniMapNodeColor?: (node: Node) => string;
  children?: ReactNode;
}

const DEFAULT_MINIMAP_COLOR = (node: Node): string => {
  const s = node.data?.status as string | undefined;
  if (s === "done") return "#22c55e";
  if (s === "running") return "#f59e0b";
  if (s === "error") return "#ef4444";
  if (s === "queued") return "#60a5fa";
  return "#a1a1aa";
};

const FlowCanvasInner = memo(function FlowCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onPaneClick,
  onDragOver,
  onDrop,
  nodeTypes,
  fitView = true,
  miniMapNodeColor = DEFAULT_MINIMAP_COLOR,
  children,
}: FlowCanvasProps) {
  return (
    <div className="flex-1 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        fitView={fitView}
        deleteKeyCode={["Backspace", "Delete"]}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls className="!bg-background !border !shadow-sm" />
        <MiniMap
          className="!bg-background !border"
          nodeColor={miniMapNodeColor}
        />
      </ReactFlow>
      {children}
    </div>
  );
});

/**
 * Reusable Flow Canvas with ReactFlowProvider wrapper.
 * Use this as the base for both ARIS pipeline and Agent Teams canvases.
 */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/**
 * Flow canvas without provider wrapper (use when provider is already present).
 */
export { FlowCanvasInner };
