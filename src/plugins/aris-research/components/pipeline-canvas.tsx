"use client";

import { useState, useCallback, useRef, useMemo, type DragEvent } from "react";
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

import type { Pipeline, PipelineNode, PipelineEdge, ResearchProgram, NodeStatus } from "../types";
import { ARIS_SKILLS } from "../skill-data";
import { autoLayout } from "../lib/auto-layout";
import { PIPELINE_TEMPLATES } from "../pipeline-templates";
import { savePipeline, getPipeline, getPipelines } from "../pipeline-store";
import { PipelineExecutor, type ExecutionEvent } from "../lib/pipeline-executor";
import { nodeTypes } from "./skill-node";
import { SkillPalette } from "./skill-palette";
import { PipelineToolbar } from "./pipeline-toolbar";
import { NodeConfigPanel } from "./node-config-panel";
import { ResearchProgramEditor } from "./research-program-editor";
import { ExecutionMonitor } from "./execution-monitor";

function generateId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function toFlowNodes(pNodes: PipelineNode[], isZh: boolean): Node[] {
  return pNodes.map((n) => ({
    id: n.id,
    type: "skill",
    position: n.position,
    data: { skillId: n.skillId, status: n.status, paramValues: n.paramValues, notes: n.notes, isZh },
  }));
}

function toFlowEdges(pEdges: PipelineEdge[]): Edge[] {
  return pEdges.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    animated: false, style: { strokeWidth: 2 },
  }));
}

function fromFlowNodes(nodes: Node[]): PipelineNode[] {
  return nodes.map((n) => ({
    id: n.id,
    skillId: n.data.skillId as string,
    position: n.position,
    status: (n.data.status as NodeStatus) ?? "idle",
    paramValues: (n.data.paramValues as Record<string, string>) ?? {},
    notes: (n.data.notes as string) ?? "",
  }));
}

function fromFlowEdges(edges: Edge[]): PipelineEdge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

const DEFAULT_PROGRAM: ResearchProgram = { brief: "", attachments: [], templateId: null };

function PipelineCanvasInner({ locale }: { locale: string }) {
  const isZh = locale === "zh-CN";
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [pipelineId, setPipelineId] = useState(() => `pl-${Date.now()}`);
  const [name, setName] = useState(isZh ? "新流水线" : "New Pipeline");
  const [program, setProgram] = useState<ResearchProgram>(DEFAULT_PROGRAM);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const executorRef = useRef<PipelineExecutor | null>(null);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const fn = nodes.find((n) => n.id === selectedNodeId);
    if (!fn) return null;
    return {
      id: fn.id, skillId: fn.data.skillId as string, position: fn.position,
      status: (fn.data.status as NodeStatus) ?? "idle",
      paramValues: (fn.data.paramValues as Record<string, string>) ?? {},
      notes: (fn.data.notes as string) ?? "",
    } as PipelineNode;
  }, [selectedNodeId, nodes]);

  const currentPipeline = useMemo((): Pipeline => ({
    id: pipelineId, name, nameZh: name, description: "", descriptionZh: "",
    nodes: fromFlowNodes(nodes), edges: fromFlowEdges(edges),
    program, isTemplate: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }), [pipelineId, name, nodes, edges, program]);

  // --- Handlers ---
  const onConnect: OnConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge({ ...conn, style: { strokeWidth: 2 } }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => setSelectedNodeId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  const onDragOver = useCallback((e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }, []);
  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const skillId = e.dataTransfer.getData("application/aris-skill");
    if (!skillId || !ARIS_SKILLS.find((s) => s.id === skillId)) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes((nds) => [...nds, {
      id: generateId(), type: "skill", position,
      data: { skillId, status: "idle", paramValues: {}, notes: "", isZh },
    }]);
  }, [screenToFlowPosition, setNodes, isZh]);

  const onUpdateNode = useCallback((nodeId: string, patch: Partial<PipelineNode>) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      return { ...n, data: { ...n.data, ...patch } };
    }));
  }, [setNodes]);

  const updateNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, status } } : n
    ));
  }, [setNodes]);

  // Load template
  const handleLoadTemplate = useCallback((templateId: string) => {
    const tpl = PIPELINE_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setNodes(toFlowNodes(tpl.nodes, isZh));
    setEdges(toFlowEdges(tpl.edges));
    setProgram(tpl.program);
    setName(isZh ? tpl.nameZh : tpl.name);
    setPipelineId(`pl-${Date.now()}`);
    setSelectedNodeId(null);
    setSaveStatus("idle");
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [setNodes, setEdges, fitView, isZh]);

  // Load saved pipeline
  const handleLoadSaved = useCallback((plId: string) => {
    const pl = getPipeline(plId);
    if (!pl) return;
    setNodes(toFlowNodes(pl.nodes, isZh));
    setEdges(toFlowEdges(pl.edges));
    setProgram(pl.program);
    setName(pl.name);
    setPipelineId(pl.id);
    setSelectedNodeId(null);
    setSaveStatus("idle");
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [setNodes, setEdges, fitView, isZh]);

  const handleAutoLayout = useCallback(() => {
    const laid = autoLayout(fromFlowNodes(nodes), fromFlowEdges(edges));
    setNodes(toFlowNodes(laid, isZh));
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [nodes, edges, setNodes, fitView, isZh]);

  const handleSave = useCallback(() => {
    savePipeline(currentPipeline);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, [currentPipeline]);

  // --- Execution ---
  const handleRun = useCallback(() => {
    setIsRunning(true);
    setExecutionLogs([]);

    const executor = new PipelineExecutor(currentPipeline, (event: ExecutionEvent) => {
      if (event.type === "node-status" && event.nodeId && event.status) {
        updateNodeStatus(event.nodeId, event.status);
      }
      if (event.type === "log" && event.message) {
        setExecutionLogs((prev) => [...prev.slice(-100), `[${new Date().toLocaleTimeString()}] ${event.message}`]);
      }
      if (event.type === "pipeline-done" || event.type === "pipeline-error") {
        setIsRunning(false);
        setExecutionLogs((prev) => [...prev, `\n=== ${event.message} ===`]);
      }
    });

    executorRef.current = executor;
    executor.run();
  }, [currentPipeline, updateNodeStatus]);

  const handleStop = useCallback(() => {
    executorRef.current?.abort();
    setIsRunning(false);
  }, []);

  const handleNew = useCallback(() => {
    setNodes([]); setEdges([]);
    setProgram(DEFAULT_PROGRAM);
    setName(isZh ? "新流水线" : "New Pipeline");
    setPipelineId(`pl-${Date.now()}`);
    setSelectedNodeId(null);
    setSaveStatus("idle");
    setExecutionLogs([]);
  }, [setNodes, setEdges, isZh]);

  return (
    <div className="flex flex-col h-full">
      <PipelineToolbar
        name={name} onNameChange={setName}
        onLoadTemplate={handleLoadTemplate}
        onLoadSaved={handleLoadSaved}
        onAutoLayout={handleAutoLayout}
        onFitView={() => fitView({ padding: 0.2 })}
        onSave={handleSave} onRun={handleRun} onStop={handleStop}
        onNew={handleNew} onDelete={handleNew}
        hasNodes={nodes.length > 0} isRunning={isRunning}
        isZh={isZh} saveStatus={saveStatus}
      />

      <div className="flex flex-1 overflow-hidden">
        <SkillPalette locale={locale} />

        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
            onDragOver={onDragOver} onDrop={onDrop}
            nodeTypes={nodeTypes} fitView
            deleteKeyCode={["Backspace", "Delete"]}
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls className="!bg-background !border !shadow-sm" />
            <MiniMap className="!bg-background !border" nodeColor={(n) => {
              const s = n.data?.status as string;
              if (s === "done") return "#22c55e";
              if (s === "running") return "#f59e0b";
              if (s === "error") return "#ef4444";
              if (s === "queued") return "#60a5fa";
              return "#a1a1aa";
            }} />
          </ReactFlow>

          {/* Execution log overlay */}
          {executionLogs.length > 0 && (
            <div className="absolute bottom-2 left-14 right-2 max-h-[150px] bg-zinc-950/90 backdrop-blur-sm text-zinc-200 rounded-lg p-3 overflow-y-auto font-mono text-[11px] leading-relaxed border border-zinc-700">
              {executionLogs.map((log, i) => (
                <div key={i} className={log.includes("ERROR") ? "text-red-400" : log.includes("Completed") ? "text-green-400" : ""}>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode} onUpdate={onUpdateNode}
            onClose={() => setSelectedNodeId(null)} isZh={isZh}
          />
        )}
      </div>

      <ResearchProgramEditor program={program} onChange={setProgram} isZh={isZh} />
      <ExecutionMonitor pipeline={currentPipeline} isZh={isZh} />
    </div>
  );
}

export interface PipelineCanvasProps {
  locale: string;
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <PipelineCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
