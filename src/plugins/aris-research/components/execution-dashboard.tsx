"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Clock,
  Loader2,
  Check,
  X,
  Lock,
  Pause,
  Square,
  ArrowLeft,
  Copy,
  FileText,
  FolderOpen,
  ChevronRight,
  ExternalLink,
  Terminal,
  ClipboardList,
} from "lucide-react";
import type { Pipeline, PipelineNode, PipelineEdge, NodeStatus } from "../types";
import { ARIS_SKILLS } from "../skill-data";
import { ExecutionReport } from "./execution-report";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutionDashboardProps {
  pipeline: Pipeline;
  isZh: boolean;
  logs: string[];
  workspacePath: string | null;
  workspaceName: string | null;
  pendingCheckpoint: string | null;
  onCheckpointResolve: (approved: boolean) => void;
  onStop: () => void;
  onBackToDesigner: () => void;
  startTime: number;
}

interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<NodeStatus, string> = {
  idle: "#71717a",     // zinc-500
  queued: "#60a5fa",   // blue-400
  running: "#f59e0b",  // amber-500
  done: "#22c55e",     // green-500
  error: "#ef4444",    // red-500
  skipped: "#a1a1aa",  // zinc-400
  checkpoint: "#eab308", // yellow-500
};

const STATUS_ICONS: Record<NodeStatus, React.ReactNode> = {
  idle: <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />,
  queued: <Clock className="h-3.5 w-3.5 text-blue-400 shrink-0" />,
  running: <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />,
  done: <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />,
  error: <X className="h-3.5 w-3.5 text-red-500 shrink-0" />,
  skipped: <X className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />,
  checkpoint: <Lock className="h-3.5 w-3.5 text-yellow-500 animate-pulse shrink-0" />,
};

const CATEGORY_OUTPUT_DIR: Record<string, string> = {
  research: "agent-docs/knowledge",
  workflow: "agent-docs/plan",
  experiment: "experiments",
  paper: "paper",
  utility: "agent-docs",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Topological sort of pipeline nodes using Kahn's algorithm. */
function topologicalSort(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    const targets = adjacency.get(edge.source);
    if (targets) targets.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: PipelineNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const target of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(target) ?? 1) - 1;
      inDegree.set(target, newDeg);
      if (newDeg === 0) queue.push(target);
    }
  }

  // Append any nodes not reached (disconnected)
  for (const node of nodes) {
    if (!sorted.find((s) => s.id === node.id)) {
      sorted.push(node);
    }
  }

  return sorted;
}

function getSkillName(skillId: string, isZh: boolean): string {
  const skill = ARIS_SKILLS.find((s) => s.id === skillId);
  if (!skill) return skillId;
  return isZh ? skill.nameZh : skill.name;
}

function getSkillCategory(skillId: string): string {
  const skill = ARIS_SKILLS.find((s) => s.id === skillId);
  return skill?.category ?? "utility";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Colored log line for the terminal view */
function LogLine({ line }: { line: string }) {
  let colorClass = "text-zinc-300";
  if (line.includes("ERROR") || line.includes("error")) {
    colorClass = "text-red-400";
  } else if (line.includes("Completed") || line.includes("completed") || line.includes("SUCCESS")) {
    colorClass = "text-green-400";
  } else if (line.includes("CHECKPOINT") || line.includes("checkpoint") || line.includes("WARNING")) {
    colorClass = "text-yellow-400";
  }

  return <div className={`${colorClass} leading-relaxed`}>{line}</div>;
}

/** Mini DAG SVG showing pipeline structure with status colors */
function MiniDAG({
  nodes,
  edges,
}: {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}) {
  const sortedNodes = useMemo(() => topologicalSort(nodes, edges), [nodes, edges]);

  // Layout: arrange nodes in rows based on topological layers
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      const targets = adjacency.get(edge.source);
      if (targets) targets.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    // Assign layers via BFS
    const layers: string[][] = [];
    const layerOf = new Map<string, number>();
    const remaining = new Map(inDegree);
    let currentLayer: string[] = [];

    for (const [id, deg] of remaining) {
      if (deg === 0) currentLayer.push(id);
    }

    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      for (const id of currentLayer) {
        layerOf.set(id, layers.length - 1);
      }
      const nextLayer: string[] = [];
      for (const id of currentLayer) {
        for (const target of adjacency.get(id) ?? []) {
          const newDeg = (remaining.get(target) ?? 1) - 1;
          remaining.set(target, newDeg);
          if (newDeg === 0) nextLayer.push(target);
        }
      }
      currentLayer = nextLayer;
    }

    // Assign any remaining disconnected nodes
    for (const node of nodes) {
      if (!layerOf.has(node.id)) {
        const newLayer = layers.length;
        layers.push([node.id]);
        layerOf.set(node.id, newLayer);
      }
    }

    const padding = 20;
    const layerHeight = layers.length > 1 ? (180 - 2 * padding) / (layers.length - 1) : 0;

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const layerWidth = layer.length > 1 ? (200 - 2 * padding) / (layer.length - 1) : 0;
      for (let ni = 0; ni < layer.length; ni++) {
        const x = layer.length === 1 ? 100 : padding + ni * layerWidth;
        const y = layers.length === 1 ? 90 : padding + li * layerHeight;
        pos.set(layer[ni], { x, y });
      }
    }

    return pos;
  }, [nodes, edges]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <svg width="100%" viewBox="0 0 200 180" className="block">
      {/* Edges */}
      {edges.map((edge) => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return null;
        return (
          <line
            key={edge.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#52525b"
            strokeWidth={1.5}
            strokeOpacity={0.5}
          />
        );
      })}
      {/* Nodes */}
      {sortedNodes.map((node) => {
        const p = positions.get(node.id);
        if (!p) return null;
        const color = STATUS_COLORS[node.status] ?? STATUS_COLORS.idle;
        return (
          <circle
            key={node.id}
            cx={p.x}
            cy={p.y}
            r={6}
            fill={color}
            stroke="#27272a"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

/** Simple file browser for the Outputs tab */
function OutputFileBrowser({
  node,
  workspacePath,
  isZh,
}: {
  node: PipelineNode | null;
  workspacePath: string | null;
  isZh: boolean;
}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const category = node ? getSkillCategory(node.skillId) : "utility";
  const outputDir = CATEGORY_OUTPUT_DIR[category] ?? "agent-docs";

  const fetchFiles = useCallback(
    async (subPath: string) => {
      if (!workspacePath) return;
      setLoading(true);
      try {
        const fullPath = subPath
          ? `${workspacePath}/${subPath}`
          : `${workspacePath}/${outputDir}`;
        const res = await fetch(`/api/browse?path=${encodeURIComponent(fullPath)}`);
        const data = await res.json();
        const entries: FileEntry[] = (data.entries ?? [])
          .filter((e: FileEntry) => !e.name.startsWith("."))
          .sort((a: FileEntry, b: FileEntry) => {
            if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        setFiles(entries);
      } catch {
        setFiles([]);
      }
      setLoading(false);
    },
    [workspacePath, outputDir]
  );

  // Reset when selected node changes
  useEffect(() => {
    setCurrentPath("");
    setBreadcrumbs([]);
    setPreviewContent(null);
    setPreviewFile(null);
    if (node && node.status === "done") {
      fetchFiles("");
    } else {
      setFiles([]);
    }
  }, [fetchFiles, node?.id, node?.status]);

  const handleNavigate = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "directory") {
        const newPath = currentPath
          ? `${currentPath}/${entry.name}`
          : `${outputDir}/${entry.name}`;
        setCurrentPath(newPath);
        setBreadcrumbs((prev) => [...prev, entry.name]);
        setPreviewContent(null);
        setPreviewFile(null);
        fetchFiles(newPath);
      } else {
        const filePath = currentPath
          ? `${workspacePath}/${currentPath}/${entry.name}`
          : `${workspacePath}/${outputDir}/${entry.name}`;
        setPreviewFile(entry.name);
        setPreviewLoading(true);
        fetch(`/api/file-preview?path=${encodeURIComponent(filePath)}`)
          .then((res) => res.json())
          .then((data) => setPreviewContent(data.content ?? "(empty)"))
          .catch(() => setPreviewContent("(unable to load file)"))
          .finally(() => setPreviewLoading(false));
      }
    },
    [currentPath, outputDir, workspacePath, fetchFiles]
  );

  const handleGoBack = useCallback(() => {
    if (previewContent !== null) {
      setPreviewContent(null);
      setPreviewFile(null);
      return;
    }
    const newBreadcrumbs = breadcrumbs.slice(0, -1);
    setBreadcrumbs(newBreadcrumbs);
    const newPath =
      newBreadcrumbs.length > 0
        ? `${outputDir}/${newBreadcrumbs.join("/")}`
        : "";
    setCurrentPath(newPath);
    fetchFiles(newPath);
  }, [breadcrumbs, outputDir, fetchFiles, previewContent]);

  const handleCopyContent = useCallback(() => {
    if (previewContent) {
      navigator.clipboard.writeText(previewContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [previewContent]);

  const handleOpenFolder = useCallback(() => {
    if (!workspacePath) return;
    const fullPath = currentPath
      ? `${workspacePath}/${currentPath}`
      : `${workspacePath}/${outputDir}`;
    fetch(`/api/browse?open=${encodeURIComponent(fullPath)}`).catch(() => {});
  }, [workspacePath, currentPath, outputDir]);

  // No node selected state
  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {isZh
              ? "选择一个已完成的节点以浏览输出文件"
              : "Select a completed node to browse outputs"}
          </p>
        </div>
      </div>
    );
  }

  if (!workspacePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p className="text-sm">
          {isZh
            ? "未找到工作区。运行 Pipeline 后才能查看输出。"
            : "No workspace found. Run the pipeline first to see outputs."}
        </p>
      </div>
    );
  }

  if (node.status !== "done") {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">
            {isZh
              ? "该节点尚未完成，完成后可查看输出"
              : "This node has not completed yet"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-muted/30 text-[11px] shrink-0">
        {(breadcrumbs.length > 0 || previewContent !== null) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 w-5 p-0"
            onClick={handleGoBack}
          >
            <ArrowLeft className="h-3 w-3" />
          </Button>
        )}
        <span className="text-muted-foreground truncate flex-1">
          {previewFile
            ? previewFile
            : breadcrumbs.length > 0
              ? breadcrumbs.join(" / ")
              : outputDir}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0"
          onClick={handleOpenFolder}
          title={isZh ? "打开文件夹" : "Open folder"}
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading...</span>
          </div>
        ) : previewContent !== null ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-1 px-3 py-1 border-b shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2 gap-1"
                onClick={handleCopyContent}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied
                  ? isZh ? "已复制" : "Copied"
                  : isZh ? "复制内容" : "Copy"}
              </Button>
            </div>
            {previewLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <pre className="flex-1 p-3 text-[11px] font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90 overflow-y-auto">
                {previewContent}
              </pre>
            )}
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">
              {isZh ? "此目录下暂无文件" : "No files in this directory"}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {files.map((entry) => (
              <button
                key={entry.name}
                className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
                onClick={() => handleNavigate(entry)}
              >
                {entry.type === "directory" ? (
                  <FolderOpen className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-xs font-medium truncate flex-1">
                  {entry.name}
                </span>
                {entry.size != null && entry.type === "file" && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatSize(entry.size)}
                  </span>
                )}
                {entry.type === "directory" && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ExecutionDashboard({
  pipeline,
  isZh,
  logs,
  workspacePath,
  workspaceName,
  pendingCheckpoint,
  onCheckpointResolve,
  onStop,
  onBackToDesigner,
  startTime,
}: ExecutionDashboardProps) {
  const [elapsed, setElapsed] = useState<number>(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("logs");
  const [logsCopied, setLogsCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Sorted nodes in topological order
  const sortedNodes = useMemo(
    () => topologicalSort(pipeline.nodes, pipeline.edges),
    [pipeline.nodes, pipeline.edges]
  );

  // Detect pipeline completion for auto-switching to report tab
  const isPipelineComplete = useMemo(
    () =>
      pipeline.nodes.length > 0 &&
      pipeline.nodes.every(
        (n) => n.status === "done" || n.status === "error" || n.status === "skipped"
      ),
    [pipeline.nodes]
  );

  // Auto-switch to report tab when pipeline completes
  const hasAutoSwitched = useRef(false);
  useEffect(() => {
    if (isPipelineComplete && !hasAutoSwitched.current) {
      hasAutoSwitched.current = true;
      setActiveTab("report");
    }
  }, [isPipelineComplete]);

  // Elapsed timer
  useEffect(() => {
    setElapsed(Date.now() - startTime);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    const container = logContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs]);

  // Progress stats
  const completedCount = pipeline.nodes.filter((n) => n.status === "done").length;
  const totalCount = pipeline.nodes.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Find currently running node
  const runningNode = pipeline.nodes.find((n) => n.status === "running");

  // Auto-select running node when no explicit selection
  const effectiveSelectedNodeId = selectedNodeId ?? runningNode?.id ?? null;
  const selectedNode = effectiveSelectedNodeId
    ? pipeline.nodes.find((n) => n.id === effectiveSelectedNodeId) ?? null
    : null;

  const handleNodeClick = useCallback(
    (node: PipelineNode) => {
      setSelectedNodeId(node.id);
      if (node.status === "done") {
        setActiveTab("outputs");
      } else if (node.status === "running") {
        setActiveTab("logs");
      }
    },
    []
  );

  const handleCopyLogs = useCallback(() => {
    navigator.clipboard.writeText(logs.join("\n"));
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 2000);
  }, [logs]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* ── Header Bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0">
        {/* Pipeline name */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <Terminal className="h-4 w-4 text-primary shrink-0" />
          <h2 className="text-sm font-semibold truncate max-w-[200px]">
            {isZh ? pipeline.nameZh : pipeline.name}
          </h2>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {completedCount}/{totalCount} {isZh ? "已完成" : "completed"}
          </span>
          <div className="flex-1 max-w-[200px] h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Timer */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono">{formatElapsed(elapsed)}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={onStop}
          >
            <Square className="h-3 w-3" />
            {isZh ? "停止" : "Stop"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            onClick={onBackToDesigner}
          >
            <ArrowLeft className="h-3 w-3" />
            {isZh ? "返回设计" : "Back to Designer"}
          </Button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel: Progress List + Mini DAG ── */}
        <div className="w-[240px] border-r flex flex-col shrink-0 overflow-hidden">
          {/* Progress list */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-2 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                {isZh ? "执行进度" : "Progress"}
              </span>
            </div>
            {sortedNodes.map((node) => {
              const isSelected = effectiveSelectedNodeId === node.id;
              const isRunning = node.status === "running";
              const skillName = getSkillName(node.skillId, isZh);

              return (
                <button
                  key={node.id}
                  className={`
                    w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors
                    hover:bg-accent/50
                    ${isRunning ? "border-l-2 border-l-amber-400 bg-amber-500/5" : "border-l-2 border-l-transparent"}
                    ${isSelected ? "bg-accent" : ""}
                  `}
                  onClick={() => handleNodeClick(node)}
                >
                  {STATUS_ICONS[node.status]}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{skillName}</div>
                    <div className="flex items-center gap-1">
                      {node.status === "done" && (
                        <span className="text-[10px] text-green-600">
                          {isZh ? "完成" : "Done"}
                        </span>
                      )}
                      {node.status === "running" && (
                        <RunningTimer startTime={startTime} isZh={isZh} />
                      )}
                      {node.status === "error" && (
                        <span className="text-[10px] text-red-500">
                          {isZh ? "错误" : "Error"}
                        </span>
                      )}
                      {node.checkpoint && (
                        <Badge
                          variant="outline"
                          className="text-[8px] px-1 py-0 border-amber-400 text-amber-600"
                        >
                          CP
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Mini DAG */}
          <div className="border-t px-2 py-2 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
              {isZh ? "流程图" : "DAG"}
            </span>
            <div className="mt-1">
              <MiniDAG nodes={pipeline.nodes} edges={pipeline.edges} />
            </div>
          </div>
        </div>

        {/* ── Right Panel: Tabs ── */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between border-b px-3 shrink-0">
            <TabsList className="h-8">
              <TabsTrigger value="logs" className="text-xs h-7 px-3 gap-1">
                <Terminal className="h-3 w-3" />
                {isZh ? "日志" : "Logs"}
              </TabsTrigger>
              <TabsTrigger value="outputs" className="text-xs h-7 px-3 gap-1">
                <FolderOpen className="h-3 w-3" />
                {isZh ? "输出" : "Outputs"}
              </TabsTrigger>
              <TabsTrigger
                value="report"
                className="text-xs h-7 px-3 gap-1"
                disabled={!isPipelineComplete}
              >
                <ClipboardList className="h-3 w-3" />
                {isZh ? "报告" : "Report"}
                {isPipelineComplete && (
                  <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                )}
              </TabsTrigger>
            </TabsList>

            {/* Copy logs button (only in logs tab) */}
            {activeTab === "logs" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2 gap-1"
                onClick={handleCopyLogs}
              >
                {logsCopied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {logsCopied
                  ? isZh ? "已复制" : "Copied"
                  : isZh ? "复制日志" : "Copy logs"}
              </Button>
            )}
          </div>

          {/* Logs tab content */}
          <TabsContent value="logs" className="flex-1 overflow-hidden m-0">
            <div
              ref={logContainerRef}
              className="h-full overflow-y-auto bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed"
            >
              {logs.length === 0 ? (
                <div className="text-zinc-500 text-center py-8">
                  {isZh ? "等待日志输出..." : "Waiting for logs..."}
                </div>
              ) : (
                logs.map((line, i) => <LogLine key={i} line={line} />)
              )}
            </div>
          </TabsContent>

          {/* Outputs tab content */}
          <TabsContent value="outputs" className="flex-1 overflow-hidden m-0">
            <OutputFileBrowser
              node={selectedNode}
              workspacePath={workspacePath}
              isZh={isZh}
            />
          </TabsContent>

          {/* Report tab content */}
          <TabsContent value="report" className="flex-1 overflow-hidden m-0">
            <ExecutionReport
              pipeline={pipeline}
              isZh={isZh}
              logs={logs}
              workspacePath={workspacePath}
              startTime={startTime}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Checkpoint Bar (conditional) ── */}
      {pendingCheckpoint !== null && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-yellow-500/10 border-t border-yellow-500/30 shrink-0">
          <Pause className="h-4 w-4 text-yellow-600 shrink-0" />
          <span className="text-sm flex-1 text-yellow-700 dark:text-yellow-400">
            {isZh
              ? `Checkpoint: ${pendingCheckpoint} 等待审批`
              : `Checkpoint: ${pendingCheckpoint} waiting for approval`}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => onCheckpointResolve(false)}
          >
            {isZh ? "拒绝" : "Reject"}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onCheckpointResolve(true)}
          >
            {isZh ? "批准继续" : "Approve"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Live timer for a running node, updates every second */
function RunningTimer({ startTime, isZh }: { startTime: number; isZh: boolean }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-[10px] text-amber-500 font-mono">
      {formatDuration(now - startTime)}
    </span>
  );
}
