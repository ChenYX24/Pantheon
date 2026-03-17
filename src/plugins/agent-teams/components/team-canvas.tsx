"use client";

import {
  useState, useCallback, useRef, useMemo, useEffect,
  type DragEvent,
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

import dagre from "dagre";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Maximize2, Save, Play, RotateCcw } from "lucide-react";

import type { AgentTeam, TeamMember } from "../types";
import * as store from "../team-store";
import { AgentNode, type AgentNodeData, type AgentNodeStatus } from "./agent-node";
import { DecisionNode } from "./decision-node";
import { AggregatorNode } from "./aggregator-node";
import { MemberPalette } from "./member-palette";
import { ExecutionPanel, type ExecutionNodeStatus } from "./execution-panel";

// ---- Node types (OUTSIDE component for React Flow perf) ----
const nodeTypes = {
  agent: AgentNode,
  decision: DecisionNode,
  aggregator: AggregatorNode,
};

// ---- Layout constants ----
const AGENT_NODE_WIDTH = 260;
const AGENT_NODE_HEIGHT = 120;
const DECISION_NODE_SIZE = 120;
const AGGREGATOR_NODE_SIZE = 100;

// ---- Helpers ----
function generateId(prefix = "n") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateMemberId(): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        style: { strokeWidth: 2 },
      });
    }
  }
  // For sequential: chain by order
  if (edges.length === 0 && members.length > 1) {
    const sorted = [...members].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length - 1; i++) {
      edges.push({
        id: `e-${sorted[i].id}-${sorted[i + 1].id}`,
        source: sorted[i].id,
        target: sorted[i + 1].id,
        style: { strokeWidth: 2 },
      });
    }
  }
  return edges;
}

/** Auto-layout nodes using dagre */
function autoLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 60 });

  for (const node of nodes) {
    const w = node.type === "decision" ? DECISION_NODE_SIZE
      : node.type === "aggregator" ? AGGREGATOR_NODE_SIZE
      : AGENT_NODE_WIDTH;
    const h = node.type === "decision" ? DECISION_NODE_SIZE
      : node.type === "aggregator" ? AGGREGATOR_NODE_SIZE
      : AGENT_NODE_HEIGHT;
    g.setNode(node.id, { width: w, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const w = node.type === "decision" ? DECISION_NODE_SIZE
      : node.type === "aggregator" ? AGGREGATOR_NODE_SIZE
      : AGENT_NODE_WIDTH;
    const h = node.type === "decision" ? DECISION_NODE_SIZE
      : node.type === "aggregator" ? AGGREGATOR_NODE_SIZE
      : AGENT_NODE_HEIGHT;
    return {
      ...node,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}

/** Extract node positions from current nodes */
function extractPositions(nodes: Node[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    positions[n.id] = { x: n.position.x, y: n.position.y };
  }
  return positions;
}

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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [nodeStatuses, setNodeStatuses] = useState<ExecutionNodeStatus[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Initialize from team
  useEffect(() => {
    if (initialized) return;

    const initialNodes = membersToNodes(
      team.members,
      (team as unknown as { canvas?: { memberPositions?: Record<string, { x: number; y: number }> } }).canvas?.memberPositions,
      isZh,
    );
    const initialEdges = membersToEdges(team.members);

    // Check if we have saved positions
    const hasPositions = (team as unknown as { canvas?: { memberPositions?: Record<string, { x: number; y: number }> } }).canvas?.memberPositions;

    if (hasPositions && Object.keys(hasPositions).length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    } else {
      // Auto-layout
      const laid = autoLayoutNodes(initialNodes, initialEdges);
      setNodes(laid);
      setEdges(initialEdges);
    }

    setInitialized(true);
    setTimeout(() => fitView({ padding: 0.2 }), 150);
  }, [team, isZh, initialized, setNodes, setEdges, fitView]);

  // ---- Handlers ----
  const onConnect: OnConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({ ...conn, style: { strokeWidth: 2 } }, eds)),
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/agent-team-template");
    if (!raw) return;

    let tpl: { id: string; name: string; nameZh: string; role: string; roleZh: string; provider: string; model: string; category: string };
    try {
      tpl = JSON.parse(raw);
    } catch {
      return;
    }

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    // Decision node
    if (tpl.role === "decision" || tpl.category === "utilities" && tpl.id === "tpl-decision") {
      setNodes((nds) => [...nds, {
        id: generateId("dec"),
        type: "decision",
        position,
        data: { condition: isZh ? "条件?" : "Condition?", isZh },
      }]);
      return;
    }

    // Aggregator node
    if (tpl.role === "aggregator" || tpl.category === "utilities" && tpl.id === "tpl-aggregator") {
      setNodes((nds) => [...nds, {
        id: generateId("agg"),
        type: "aggregator",
        position,
        data: { label: isZh ? "合并" : "Merge", inputCount: 0, isZh },
      }]);
      return;
    }

    // Agent node
    const memberId = generateMemberId();
    setNodes((nds) => [...nds, {
      id: memberId,
      type: "agent",
      position,
      data: {
        memberId,
        name: isZh ? tpl.nameZh : tpl.name,
        role: isZh ? tpl.roleZh ?? tpl.role : tpl.role,
        provider: tpl.provider,
        model: tpl.model,
        status: "idle" as AgentNodeStatus,
        tokens: undefined,
        isZh,
      } satisfies AgentNodeData,
    }]);
  }, [screenToFlowPosition, setNodes, isZh]);

  const handleAutoLayout = useCallback(() => {
    const laid = autoLayoutNodes(nodes, edges);
    setNodes(laid);
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [nodes, edges, setNodes, fitView]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  const handleSave = useCallback(() => {
    // Extract positions and sync members back to team
    const positions = extractPositions(nodes);

    // Build updated members from agent nodes
    const agentNodes = nodes.filter((n) => n.type === "agent");
    const updatedMembers: TeamMember[] = agentNodes.map((n, idx) => {
      const d = n.data as AgentNodeData;
      // Find existing member to preserve fields
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
      updated_at: new Date().toISOString(),
    };

    // Attach canvas data (positions)
    (updatedTeam as unknown as { canvas: { memberPositions: Record<string, { x: number; y: number }> } }).canvas = {
      memberPositions: positions,
    };

    store.updateTeam(team.id, updatedTeam);
    onTeamUpdate(updatedTeam);
  }, [nodes, team, onTeamUpdate]);

  // ---- Execution (mock) ----
  const handleRun = useCallback(() => {
    setIsRunning(true);
    setExecutionLogs([]);
    setTotalTokens(0);
    setElapsedMs(0);
    startTimeRef.current = Date.now();

    // Initialize node statuses
    const agentNodes = nodes.filter((n) => n.type === "agent");
    const statuses: ExecutionNodeStatus[] = agentNodes.map((n) => ({
      nodeId: n.id,
      name: (n.data as AgentNodeData).name ?? "Agent",
      status: "queued" as AgentNodeStatus,
    }));
    setNodeStatuses(statuses);

    // Update node visuals to queued
    setNodes((nds) => nds.map((n) =>
      n.type === "agent" ? { ...n, data: { ...n.data, status: "queued" } } : n
    ));

    // Timer
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 500);

    // Mock sequential execution
    const runSequential = async () => {
      for (let i = 0; i < agentNodes.length; i++) {
        const node = agentNodes[i];
        const name = (node.data as AgentNodeData).name ?? "Agent";

        // Set running
        setNodes((nds) => nds.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, status: "running" } } : n
        ));
        setEdges((eds) => eds.map((e) =>
          e.source === node.id || e.target === node.id
            ? { ...e, animated: true }
            : e
        ));
        setNodeStatuses((prev) => prev.map((ns) =>
          ns.nodeId === node.id ? { ...ns, status: "running" as AgentNodeStatus } : ns
        ));
        setExecutionLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Starting: ${name}`]);

        // Simulate work
        await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800));

        const tokens = Math.floor(500 + Math.random() * 2000);
        setTotalTokens((prev) => prev + tokens);

        // Set done
        setNodes((nds) => nds.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, status: "done", tokens } } : n
        ));
        setEdges((eds) => eds.map((e) =>
          e.source === node.id || e.target === node.id
            ? { ...e, animated: false }
            : e
        ));
        setNodeStatuses((prev) => prev.map((ns) =>
          ns.nodeId === node.id ? { ...ns, status: "done" as AgentNodeStatus, tokens } : ns
        ));
        setExecutionLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Done: ${name} (${tokens} tokens)`]);
      }

      setExecutionLogs((prev) => [...prev, `\n=== Completed all agents ===`]);
      setIsRunning(false);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    runSequential();
  }, [nodes, setNodes, setEdges]);

  const handleStop = useCallback(() => {
    setIsRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setExecutionLogs((prev) => [...prev, `\n=== Execution stopped ===`]);
    // Reset running nodes to idle
    setNodes((nds) => nds.map((n) =>
      n.type === "agent" && (n.data as AgentNodeData).status === "running"
        ? { ...n, data: { ...n.data, status: "idle" } }
        : n
    ));
  }, [setNodes]);

  const handleReset = useCallback(() => {
    setNodes((nds) => nds.map((n) =>
      n.type === "agent"
        ? { ...n, data: { ...n.data, status: "idle", tokens: undefined } }
        : n
    ));
    setEdges((eds) => eds.map((e) => ({ ...e, animated: false })));
    setExecutionLogs([]);
    setNodeStatuses([]);
    setTotalTokens(0);
    setElapsedMs(0);
  }, [setNodes, setEdges]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate max-w-[200px]">
            {team.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {nodes.filter((n) => n.type === "agent").length} {isZh ? "个成员" : "members"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleAutoLayout}
            title={isZh ? "自动布局" : "Auto Layout"}
          >
            <LayoutGrid className="h-3.5 w-3.5 mr-1" />
            {isZh ? "布局" : "Layout"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleFitView}
            title={isZh ? "适应视图" : "Fit View"}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleReset}
            title={isZh ? "重置状态" : "Reset"}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleSave}
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            {isZh ? "保存" : "Save"}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleRun}
            disabled={isRunning || nodes.filter((n) => n.type === "agent").length === 0}
          >
            <Play className="h-3.5 w-3.5 mr-1" />
            {isZh ? "运行" : "Run"}
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Palette (hidden on small screens via CSS) */}
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
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
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
                if (n.type === "decision") return "#f59e0b";
                if (n.type === "aggregator") return "#818cf8";
                return "#a1a1aa";
              }}
            />
          </ReactFlow>
        </div>
      </div>

      {/* Execution panel */}
      <ExecutionPanel
        isRunning={isRunning}
        logs={executionLogs}
        nodeStatuses={nodeStatuses}
        totalTokens={totalTokens}
        elapsedMs={elapsedMs}
        onStop={handleStop}
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
