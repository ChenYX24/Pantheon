"use client";

import {
  useState, useCallback, useEffect, useMemo,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { applyDagreLayout, extractPositions } from "@/lib/canvas";
import { Play } from "lucide-react";

import type { AgentTeam, TeamMember } from "../types";
import * as store from "../team-store";
import { AgentNode, type AgentNodeData, type AgentNodeStatus } from "./agent-node";
import { MemberPalette } from "./member-palette";
import { ExecutionPanel } from "./execution-panel";
import { NodeContextMenu, type ContextMenuAction } from "./node-context-menu";
import { CanvasToolbar } from "./canvas-toolbar";
import { useCanvasExecution } from "./use-canvas-execution";
import { useCanvasDnd } from "./use-canvas-dnd";

// ---- Node types (OUTSIDE component for React Flow perf) ----
const nodeTypes = {
  agent: AgentNode,
};

// ---- Layout constants ----
const AGENT_NODE_WIDTH = 260;
const AGENT_NODE_HEIGHT = 120;

// ---- Helpers ----
function getEdgeStyle(type?: string): { strokeWidth: number; stroke?: string; strokeDasharray?: string } {
  switch (type) {
    case "control":
      return { strokeWidth: 2, stroke: "#f59e0b", strokeDasharray: "5,5" };
    case "review":
      return { strokeWidth: 2, stroke: "#8b5cf6", strokeDasharray: "3,3" };
    default:
      return { strokeWidth: 2, stroke: "#60a5fa" };
  }
}

/** Convert team members into React Flow nodes */
function membersToNodes(
  members: TeamMember[],
  positions: Record<string, { x: number; y: number }> | undefined,
  isZh: boolean,
): Node[] {
  return members.map((m) => ({
    id: m.id,
    type: "agent",
    position: positions?.[m.id] ?? { x: 0, y: 0 },
    data: {
      memberId: m.id,
      name: m.name,
      role: m.role,
      provider: m.provider,
      model: m.model,
      status: "idle" as AgentNodeStatus,
      tokens: undefined,
      isZh,
    } satisfies AgentNodeData,
  }));
}

/** Build edges from hierarchical parentId relationships */
function membersToEdges(members: TeamMember[]): Edge[] {
  const edges: Edge[] = [];
  for (const m of members) {
    if (m.parentId) {
      edges.push({
        id: `e-${m.parentId}-${m.id}`,
        source: m.parentId,
        target: m.id,
        style: getEdgeStyle("data"),
        data: { type: "data" },
      });
    }
  }
  if (edges.length === 0 && members.length > 1) {
    const sorted = [...members].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length - 1; i++) {
      edges.push({
        id: `e-${sorted[i].id}-${sorted[i + 1].id}`,
        source: sorted[i].id,
        target: sorted[i + 1].id,
        style: getEdgeStyle("data"),
        data: { type: "data" },
      });
    }
  }
  return edges;
}

const DAGRE_OPTIONS = {
  rankdir: "TB" as const,
  ranksep: 80,
  nodesep: 60,
  nodeWidth: AGENT_NODE_WIDTH,
  nodeHeight: AGENT_NODE_HEIGHT,
};

// ---- Canvas Inner ----
interface TeamCanvasInnerProps {
  team: AgentTeam;
  onTeamUpdate: (team: AgentTeam) => void;
  locale: string;
}

function TeamCanvasInner({ team, onTeamUpdate, locale }: TeamCanvasInnerProps) {
  const isZh = locale === "zh-CN";
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Initialize nodes/edges from team data
  const [initialized, setInitialized] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
    nodeName: string;
  } | null>(null);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  // Custom hooks
  const execution = useCanvasExecution({ team, nodes, edges, setNodes, setEdges });
  const dnd = useCanvasDnd({ isZh, setNodes, screenToFlowPosition });

  // Initialize from team
  useEffect(() => {
    if (initialized) return;

    const savedPositions: Record<string, { x: number; y: number }> | undefined =
      team.canvas?.memberPositions && team.canvas.memberPositions.length > 0
        ? Object.fromEntries(
            team.canvas.memberPositions.map((n) => [n.memberId, n.position])
          )
        : undefined;

    const initialNodes = membersToNodes(team.members, savedPositions, isZh);

    const initialEdges = team.canvas?.edges && team.canvas.edges.length > 0
      ? team.canvas.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          type: "default",
          style: getEdgeStyle(e.type),
          data: { type: e.type },
        }))
      : membersToEdges(team.members);

    if (savedPositions && Object.keys(savedPositions).length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    } else {
      const laid = applyDagreLayout(initialNodes, initialEdges, DAGRE_OPTIONS);
      setNodes(laid);
      setEdges(initialEdges);
    }

    setInitialized(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-time initialization
    setTimeout(() => fitView({ padding: 0.2 }), 150);
  }, [team, isZh, initialized, setNodes, setEdges, fitView]);

  // ---- Handlers ----
  const onConnect: OnConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({
      ...conn,
      style: getEdgeStyle("data"),
      data: { type: "data" },
    }, eds)),
    [setEdges],
  );

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const types = ["data", "control", "review"] as const;
    const currentType = (edge.data?.type as string) ?? "data";
    const idx = types.indexOf(currentType as typeof types[number]);
    const nextType = types[(idx + 1) % types.length];
    setEdges((eds) => eds.map((e) =>
      e.id === edge.id
        ? { ...e, style: getEdgeStyle(nextType), data: { ...e.data, type: nextType }, label: e.label && !types.includes(e.label as typeof types[number]) ? e.label : nextType }
        : e
    ));
  }, [setEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    e.stopPropagation();
    const data = node.data as AgentNodeData;
    const MENU_W = 170, MENU_H = 120;
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - MENU_W),
      y: Math.min(e.clientY, window.innerHeight - MENU_H),
      nodeId: node.id,
      nodeName: data.name ?? "Agent",
    });
  }, []);

  const handleContextAction = useCallback((action: ContextMenuAction) => {
    if (action.type === "delete") {
      setNodes((nds) => nds.filter((n) => n.id !== action.nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== action.nodeId && e.target !== action.nodeId));
    } else if (action.type === "duplicate") {
      setNodes((nds) => {
        const sourceNode = nds.find((n) => n.id === action.nodeId);
        if (!sourceNode) return nds;
        const d = sourceNode.data as AgentNodeData;
        const newId = `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return [...nds, {
          id: newId,
          type: "agent",
          position: { x: sourceNode.position.x + 30, y: sourceNode.position.y + 30 },
          data: { ...d, memberId: newId, name: `${d.name} (copy)` } satisfies AgentNodeData,
        }];
      });
    } else if (action.type === "edit") {
      setSelectedNodeId(action.nodeId);
    }
    setContextMenu(null);
  }, [setNodes, setEdges]);

  const handleAutoLayout = useCallback(() => {
    const laid = applyDagreLayout(nodes, edges, DAGRE_OPTIONS);
    setNodes(laid);
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [nodes, edges, setNodes, fitView]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  const handleSave = useCallback(() => {
    const positions = extractPositions(nodes);

    const agentNodes = nodes.filter((n) => n.type === "agent");
    const updatedMembers: TeamMember[] = agentNodes.map((n, idx) => {
      const d = n.data as AgentNodeData;
      const existing = team.members.find((m) => m.id === d.memberId);
      return {
        id: d.memberId,
        name: d.name ?? "Agent",
        role: d.role ?? "Member",
        description: existing?.description ?? "",
        provider: (d.provider ?? "claude") as TeamMember["provider"],
        model: d.model ?? "claude-sonnet-4-5",
        systemPrompt: existing?.systemPrompt ?? "",
        tools: existing?.tools,
        order: idx,
        parentId: existing?.parentId,
        tier: existing?.tier ?? 1,
      };
    });

    const updatedTeam: AgentTeam = {
      ...team,
      members: updatedMembers,
      canvas: {
        memberPositions: Object.entries(positions).map(([memberId, pos]) => ({
          memberId,
          position: pos,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: (e.data?.type as "data" | "control" | "review") ?? "data",
          label: e.label as string | undefined,
        })),
      },
      updated_at: new Date().toISOString(),
    };

    store.updateTeamAsync(team.id, updatedTeam);
    onTeamUpdate(updatedTeam);
  }, [nodes, edges, team, onTeamUpdate]);

  const agentCount = useMemo(
    () => nodes.filter((n) => n.type === "agent").length,
    [nodes],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <CanvasToolbar
        teamName={team.name}
        agentCount={agentCount}
        isZh={isZh}
        isRunning={execution.isRunning}
        onAutoLayout={handleAutoLayout}
        onFitView={handleFitView}
        onReset={execution.handleReset}
        onSave={handleSave}
        onRun={execution.handleRun}
      />

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Palette */}
        <div className="hidden md:block">
          <MemberPalette
            locale={locale}
            collapsed={paletteCollapsed}
            onToggle={() => setPaletteCollapsed(!paletteCollapsed)}
          />
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            onDragOver={dnd.onDragOver}
            onDrop={dnd.onDrop}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls className="!bg-background !border !shadow-sm" />
            <MiniMap
              className="!bg-background !border"
              nodeColor={(n) => {
                const s = n.data?.status as string;
                if (s === "done") return "#22c55e";
                if (s === "running") return "#f59e0b";
                if (s === "error") return "#ef4444";
                if (s === "queued") return "#60a5fa";
                return "#a1a1aa";
              }}
            />
          </ReactFlow>
          {/* Edge type legend */}
          {edges.length > 0 && (
            <div className="absolute top-2 right-2 bg-background/90 backdrop-blur-sm border rounded-md px-2.5 py-1.5 text-[10px] flex items-center gap-3 shadow-sm pointer-events-none z-10">
              <div className="flex items-center gap-1">
                <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#60a5fa" strokeWidth="2" /></svg>
                <span className="text-muted-foreground">data</span>
              </div>
              <div className="flex items-center gap-1">
                <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5,5" /></svg>
                <span className="text-muted-foreground">control</span>
              </div>
              <div className="flex items-center gap-1">
                <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="3,3" /></svg>
                <span className="text-muted-foreground">review</span>
              </div>
            </div>
          )}
          {contextMenu && (
            <NodeContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              nodeId={contextMenu.nodeId}
              nodeName={contextMenu.nodeName}
              onAction={handleContextAction}
              onClose={() => setContextMenu(null)}
              isZh={isZh}
            />
          )}
        </div>
      </div>

      {/* Prompt input bar */}
      {execution.showPromptInput && (
        <div className="border-t bg-background px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 h-8 px-3 rounded-md border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={isZh ? "输入任务指令给工作流工作室..." : "Enter the task prompt for the workflow studio..."}
              value={execution.promptInput}
              onChange={(e) => execution.setPromptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && execution.promptInput.trim()) {
                  execution.handleRunWithPrompt(execution.promptInput);
                }
                if (e.key === "Escape") {
                  execution.setShowPromptInput(false);
                }
              }}
              autoFocus
            />
            <Button
              size="sm"
              className="h-8 px-3"
              onClick={() => execution.handleRunWithPrompt(execution.promptInput)}
              disabled={!execution.promptInput.trim()}
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              {isZh ? "执行" : "Execute"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => execution.setShowPromptInput(false)}
            >
              {isZh ? "取消" : "Cancel"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {isZh
              ? `${team.workflow === "parallel" ? "并行" : team.workflow === "hierarchical" ? "层级" : "顺序"}执行 ${agentCount} 个 Agent`
              : `${team.workflow} execution with ${agentCount} agents`}
          </p>
        </div>
      )}

      {/* Execution panel */}
      <ExecutionPanel
        isRunning={execution.isRunning}
        logs={execution.executionLogs}
        nodeStatuses={execution.nodeStatuses}
        nodeOutputs={execution.nodeOutputs}
        totalTokens={execution.totalTokens}
        elapsedMs={execution.elapsedMs}
        onStop={execution.handleStop}
        isZh={isZh}
      />
    </div>
  );
}

// ---- Exported component with ReactFlowProvider ----
export interface TeamCanvasProps {
  team: AgentTeam;
  onTeamUpdate: (team: AgentTeam) => void;
  locale: string;
}

export function TeamCanvas(props: TeamCanvasProps) {
  return (
    <ReactFlowProvider>
      <TeamCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
