"use client";

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  X,
  Clock,
  Download,
  Loader2,
  CheckCircle,
  XCircle,
  SkipForward,
  FileText,
} from "lucide-react";
import type { Pipeline, PipelineNode, PipelineEdge, NodeStatus } from "../types";
import { ARIS_SKILLS } from "../skill-data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutionReportProps {
  pipeline: Pipeline;
  isZh: boolean;
  logs: string[];
  workspacePath: string | null;
  startTime: number;
}

interface NodeReportData {
  id: string;
  skillName: string;
  skillNameZh: string;
  status: NodeStatus;
  durationMs: number;
  errorMessage: string;
  outputDir: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_OUTPUT_DIR: Record<string, string> = {
  research: "agent-docs/knowledge",
  workflow: "agent-docs/plan",
  experiment: "experiments",
  paper: "paper",
  utility: "agent-docs",
};

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string; icon: React.ReactNode; dotColor: string }
> = {
  done: {
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950/30",
    icon: <CheckCircle className="h-4 w-4 text-green-500" />,
    dotColor: "bg-green-500",
  },
  error: {
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    icon: <XCircle className="h-4 w-4 text-red-500" />,
    dotColor: "bg-red-500",
  },
  skipped: {
    color: "text-zinc-500 dark:text-zinc-400",
    bg: "bg-zinc-50 dark:bg-zinc-900/30",
    icon: <SkipForward className="h-4 w-4 text-zinc-400" />,
    dotColor: "bg-zinc-400",
  },
  idle: {
    color: "text-zinc-400",
    bg: "bg-zinc-50 dark:bg-zinc-900/20",
    icon: <Clock className="h-4 w-4 text-zinc-400" />,
    dotColor: "bg-zinc-300",
  },
  queued: {
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/20",
    icon: <Clock className="h-4 w-4 text-blue-400" />,
    dotColor: "bg-blue-400",
  },
  running: {
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/20",
    icon: <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />,
    dotColor: "bg-amber-400",
  },
  checkpoint: {
    color: "text-yellow-500",
    bg: "bg-yellow-50 dark:bg-yellow-950/20",
    icon: <Clock className="h-4 w-4 text-yellow-500" />,
    dotColor: "bg-yellow-500",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Topological sort for consistent ordering */
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

  for (const node of nodes) {
    if (!sorted.find((s) => s.id === node.id)) sorted.push(node);
  }
  return sorted;
}

function getNodeReportData(node: PipelineNode, isZh: boolean, logs: string[]): NodeReportData {
  const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
  const skillName = skill?.name ?? node.skillId;
  const skillNameZh = skill?.nameZh ?? node.skillId;
  const category = skill?.category ?? "utility";
  const outputDir = CATEGORY_OUTPUT_DIR[category] ?? "agent-docs";

  // Try to extract error message from logs
  let errorMessage = "";
  if (node.status === "error") {
    const errorLogs = logs.filter(
      (line) =>
        line.toLowerCase().includes("error") &&
        (line.includes(node.id) || line.includes(skillName))
    );
    errorMessage = errorLogs.length > 0 ? errorLogs[errorLogs.length - 1] : "Unknown error";
  }

  return {
    id: node.id,
    skillName,
    skillNameZh,
    status: node.status,
    durationMs: 0, // Duration not tracked per-node in current architecture
    errorMessage,
    outputDir,
    category,
  };
}

function getStatusLabel(status: string, isZh: boolean): string {
  const labels: Record<string, { en: string; zh: string }> = {
    done: { en: "Success", zh: "成功" },
    error: { en: "Error", zh: "错误" },
    skipped: { en: "Skipped", zh: "已跳过" },
    idle: { en: "Idle", zh: "空闲" },
    queued: { en: "Queued", zh: "排队中" },
    running: { en: "Running", zh: "运行中" },
    checkpoint: { en: "Checkpoint", zh: "检查点" },
  };
  const entry = labels[status];
  return entry ? (isZh ? entry.zh : entry.en) : status;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Summary cards row */
function SummaryCards({
  totalNodes,
  doneCount,
  errorCount,
  skippedCount,
  totalDuration,
  isZh,
}: {
  totalNodes: number;
  doneCount: number;
  errorCount: number;
  skippedCount: number;
  totalDuration: number;
  isZh: boolean;
}) {
  const cards = [
    {
      label: isZh ? "总节点" : "Total",
      value: totalNodes,
      color: "text-foreground",
      bg: "bg-muted/50",
    },
    {
      label: isZh ? "成功" : "Succeeded",
      value: doneCount,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-950/20",
    },
    {
      label: isZh ? "失败" : "Failed",
      value: errorCount,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-950/20",
    },
    {
      label: isZh ? "跳过" : "Skipped",
      value: skippedCount,
      color: "text-zinc-500",
      bg: "bg-zinc-50 dark:bg-zinc-900/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-lg border px-4 py-3 ${card.bg}`}
        >
          <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Vertical timeline visualization */
function Timeline({
  nodeData,
  isZh,
}: {
  nodeData: NodeReportData[];
  isZh: boolean;
}) {
  return (
    <div className="relative pl-6">
      {/* Vertical line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

      {nodeData.map((node, index) => {
        const cfg = STATUS_CONFIG[node.status] ?? STATUS_CONFIG.idle;
        const displayName = isZh ? node.skillNameZh : node.skillName;

        return (
          <div key={node.id} className="relative flex items-start gap-3 pb-4 last:pb-0">
            {/* Dot on the timeline */}
            <div
              className={`absolute left-[-13px] top-1.5 h-3 w-3 rounded-full border-2 border-background ${cfg.dotColor} shrink-0 z-10`}
            />

            {/* Content */}
            <div className={`flex-1 rounded-lg border px-3 py-2.5 ${cfg.bg} transition-colors`}>
              <div className="flex items-center gap-2">
                {cfg.icon}
                <span className="text-sm font-medium">{displayName}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${cfg.color} border-current/20`}
                >
                  {getStatusLabel(node.status, isZh)}
                </Badge>
                {node.durationMs > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                    {formatDuration(node.durationMs)}
                  </span>
                )}
              </div>

              {node.status === "error" && node.errorMessage && (
                <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-100/50 dark:bg-red-950/50 rounded px-2 py-1.5 font-mono break-all">
                  {node.errorMessage}
                </div>
              )}

              {node.status === "done" && (
                <div className="mt-1 text-[10px] text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {node.outputDir}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ExecutionReport({
  pipeline,
  isZh,
  logs,
  workspacePath,
  startTime,
}: ExecutionReportProps) {
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"saved" | "error" | null>(null);

  const sortedNodes = useMemo(
    () => topologicalSort(pipeline.nodes, pipeline.edges),
    [pipeline.nodes, pipeline.edges]
  );

  const nodeData = useMemo(
    () => sortedNodes.map((node) => getNodeReportData(node, isZh, logs)),
    [sortedNodes, isZh, logs]
  );

  const doneCount = nodeData.filter((n) => n.status === "done").length;
  const errorCount = nodeData.filter((n) => n.status === "error").length;
  const skippedCount = nodeData.filter((n) => n.status === "skipped").length;
  const totalDuration = Date.now() - startTime;

  const isComplete = pipeline.nodes.every(
    (n) => n.status === "done" || n.status === "error" || n.status === "skipped"
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/plugins/aris-research/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineName: pipeline.name,
          pipelineNameZh: pipeline.nameZh,
          workspacePath,
          startedAt: formatTime(startTime),
          completedAt: formatTime(Date.now()),
          totalDurationMs: totalDuration,
          nodes: nodeData.map((n) => ({
            id: n.id,
            skillName: n.skillName,
            skillNameZh: n.skillNameZh,
            status: n.status,
            durationMs: n.durationMs,
            errorMessage: n.errorMessage || undefined,
            outputDir: n.outputDir,
          })),
          logs,
        }),
      });
      if (res.ok) {
        setSaveResult("saved");
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult("error");
      }
    } catch {
      setSaveResult("error");
    }
    setSaving(false);
  }, [pipeline, workspacePath, startTime, totalDuration, nodeData, logs]);

  // Not ready state
  if (!isComplete) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">
        <div className="text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin opacity-30" />
          <p className="text-sm">
            {isZh
              ? "报告将在流水线完成后可用。"
              : "The report will be available after the pipeline completes."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {isZh ? "执行报告" : "Execution Report"}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isZh ? pipeline.nameZh : pipeline.name}
            </p>
          </div>
          <Button
            size="sm"
            variant={saveResult === "saved" ? "outline" : "default"}
            className="h-8 text-xs gap-1.5 shrink-0"
            onClick={handleSave}
            disabled={saving || !workspacePath}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isZh ? "保存中..." : "Saving..."}
              </>
            ) : saveResult === "saved" ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-500" />
                {isZh ? "已保存" : "Saved"}
              </>
            ) : saveResult === "error" ? (
              <>
                <X className="h-3.5 w-3.5 text-red-500" />
                {isZh ? "保存失败" : "Failed"}
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                {isZh ? "保存报告" : "Save Report"}
              </>
            )}
          </Button>
        </div>

        {/* Meta info */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm border rounded-lg p-4 bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {isZh ? "开始时间" : "Started at"}:
            </span>
            <span className="font-mono text-xs">{formatTime(startTime)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {isZh ? "完成时间" : "Completed at"}:
            </span>
            <span className="font-mono text-xs">{formatTime(Date.now())}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {isZh ? "总时长" : "Duration"}:
            </span>
            <span className="font-semibold">{formatDuration(totalDuration)}</span>
          </div>
          {workspacePath && (
            <div className="flex items-center gap-2 col-span-2">
              <span className="text-muted-foreground">
                {isZh ? "工作区" : "Workspace"}:
              </span>
              <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded truncate max-w-[400px]">
                {workspacePath}
              </code>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <SummaryCards
          totalNodes={nodeData.length}
          doneCount={doneCount}
          errorCount={errorCount}
          skippedCount={skippedCount}
          totalDuration={totalDuration}
          isZh={isZh}
        />

        {/* Timeline */}
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {isZh ? "时间线" : "Timeline"}
          </h3>
          <Timeline nodeData={nodeData} isZh={isZh} />
        </div>

        {/* Error details (if any) */}
        {errorCount > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-red-600 dark:text-red-400">
              <X className="h-4 w-4" />
              {isZh ? "错误详情" : "Error Details"}
            </h3>
            <div className="space-y-3">
              {nodeData
                .filter((n) => n.status === "error")
                .map((node) => (
                  <div
                    key={node.id}
                    className="border border-red-200 dark:border-red-800/50 rounded-lg p-3 bg-red-50/50 dark:bg-red-950/20"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                      <span className="text-sm font-medium">
                        {isZh ? node.skillNameZh : node.skillName}
                      </span>
                    </div>
                    <pre className="text-xs font-mono text-red-700 dark:text-red-300 whitespace-pre-wrap break-words bg-red-100/50 dark:bg-red-950/30 rounded px-2.5 py-2">
                      {node.errorMessage || (isZh ? "未知错误" : "Unknown error")}
                    </pre>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
