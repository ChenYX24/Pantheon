"use client";

import {
  useState, useCallback, useRef,
  type Dispatch, type SetStateAction,
} from "react";
import type { Node, Edge } from "@xyflow/react";

import type { AgentTeam } from "../types";
import type { AgentNodeData, AgentNodeStatus } from "./agent-node";
import type { ExecutionNodeStatus } from "./execution-panel";
import { TeamExecutor } from "../lib/team-executor";
import type { ExecutionEvent } from "@/lib/execution";

// ---- Public interface ----

export interface CanvasExecutionState {
  isRunning: boolean;
  executionLogs: string[];
  nodeStatuses: ExecutionNodeStatus[];
  nodeOutputs: Record<string, string>;
  totalTokens: number;
  elapsedMs: number;
  promptInput: string;
  showPromptInput: boolean;
  setPromptInput: Dispatch<SetStateAction<string>>;
  setShowPromptInput: Dispatch<SetStateAction<boolean>>;
  handleRun: () => void;
  handleRunWithPrompt: (prompt: string) => void;
  handleStop: () => void;
  handleReset: () => void;
}

export interface UseCanvasExecutionDeps {
  team: AgentTeam;
  nodes: Node[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
}

// ---- Hook ----

export function useCanvasExecution({
  team,
  nodes,
  edges,
  setNodes,
  setEdges,
}: UseCanvasExecutionDeps): CanvasExecutionState {
  const [isRunning, setIsRunning] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);
  const [nodeStatuses, setNodeStatuses] = useState<ExecutionNodeStatus[]>([]);
  const [nodeOutputs, setNodeOutputs] = useState<Record<string, string>>({});
  const [totalTokens, setTotalTokens] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [promptInput, setPromptInput] = useState("");
  const [showPromptInput, setShowPromptInput] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const executorRef = useRef<TeamExecutor | null>(null);

  const handleRunWithPrompt = useCallback((prompt: string) => {
    if (!prompt.trim()) return;
    setShowPromptInput(false);
    setIsRunning(true);
    setExecutionLogs([]);
    setNodeOutputs({});
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

    // Build edges from current canvas
    const canvasEdges = edges
      .filter((e) => {
        const src = nodes.find((n) => n.id === e.source);
        const tgt = nodes.find((n) => n.id === e.target);
        return src?.type === "agent" && tgt?.type === "agent";
      })
      .map((e) => ({ id: e.id, source: e.source, target: e.target }));

    // Create execution listener
    const listener = (event: ExecutionEvent) => {
      if (event.type === "node-status" && event.nodeId && event.status) {
        const status = event.status as AgentNodeStatus;
        setNodes((nds) => nds.map((n) =>
          n.id === event.nodeId ? { ...n, data: { ...n.data, status } } : n
        ));
        setEdges((eds) => eds.map((e) =>
          e.source === event.nodeId || e.target === event.nodeId
            ? { ...e, animated: status === "running" }
            : e
        ));
        setNodeStatuses((prev) => prev.map((ns) =>
          ns.nodeId === event.nodeId ? { ...ns, status } : ns
        ));
        // Surface node error messages as visible log entries so users see failures
        if (status === "error" && event.message) {
          const nodeName = statuses.find((ns) => ns.nodeId === event.nodeId)?.name ?? event.nodeId;
          setExecutionLogs((prev) => [
            ...prev.slice(-200),
            `[${new Date().toLocaleTimeString()}] ERROR [${nodeName}]: ${event.message}`,
          ]);
        }
      }
      if (event.type === "log" && event.message) {
        setExecutionLogs((prev) => [
          ...prev.slice(-200),
          `[${new Date().toLocaleTimeString()}] ${event.message}`,
        ]);
      }
      if (event.type === "pipeline-done" || event.type === "pipeline-error") {
        setIsRunning(false);
        if (timerRef.current) clearInterval(timerRef.current);
        setExecutionLogs((prev) => [...prev, `\n=== ${event.message} ===`]);
      }
    };

    const executor = new TeamExecutor(team, canvasEdges, listener, {
      prompt,
      team,
      edges: canvasEdges,
      maxParallel: team.workflow === "parallel" ? agentNodes.length : 1,
    });
    executorRef.current = executor;

    executor.runPipeline()
      .then((run) => {
        setTotalTokens(run.totalTokens ?? 0);
        if (run.nodeOutputs) {
          setNodeOutputs(run.nodeOutputs);
        }
      })
      .catch((err) => {
        console.error("[TeamCanvas] runPipeline failed:", err);
        setIsRunning(false);
        if (timerRef.current) clearInterval(timerRef.current);
        setExecutionLogs((prev) => [
          ...prev,
          `\n=== Error: ${err instanceof Error ? err.message : String(err)} ===`,
        ]);
      });
  }, [nodes, edges, team, setNodes, setEdges]);

  const handleRun = useCallback(() => {
    setShowPromptInput(true);
  }, []);

  const handleStop = useCallback(() => {
    executorRef.current?.abort();
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
    setNodeOutputs({});
    setTotalTokens(0);
    setElapsedMs(0);
  }, [setNodes, setEdges]);

  return {
    isRunning,
    executionLogs,
    nodeStatuses,
    nodeOutputs,
    totalTokens,
    elapsedMs,
    promptInput,
    showPromptInput,
    setPromptInput,
    setShowPromptInput,
    handleRun,
    handleRunWithPrompt,
    handleStop,
    handleReset,
  };
}
