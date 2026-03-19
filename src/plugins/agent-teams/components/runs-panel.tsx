"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  History,
  ChevronDown,
  ChevronUp,
  Clock,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileText,
} from "lucide-react";
import type { TeamRun, TeamNodeStatus } from "../types";
import { getTeamRuns } from "../team-store";

// ---- Status styling ----

const STATUS_CONFIG: Record<
  TeamRun["status"],
  { label: string; labelZh: string; color: string; icon: typeof CheckCircle2 }
> = {
  completed: {
    label: "Completed",
    labelZh: "已完成",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  error: {
    label: "Error",
    labelZh: "出错",
    color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    icon: XCircle,
  },
  aborted: {
    label: "Aborted",
    labelZh: "已中止",
    color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400",
    icon: AlertTriangle,
  },
  running: {
    label: "Running",
    labelZh: "运行中",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    icon: Loader2,
  },
};

const NODE_STATUS_COLORS: Record<TeamNodeStatus, string> = {
  idle: "text-zinc-400",
  queued: "text-blue-400",
  running: "text-amber-500",
  done: "text-emerald-500",
  error: "text-red-500",
  skipped: "text-zinc-400",
};

// ---- Helpers ----

function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isToday) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- Agent output entry component ----

function AgentOutputEntry({
  name,
  output,
}: {
  name: string;
  output: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = output.length > 200 ? output.slice(0, 200) + "..." : output;

  return (
    <div className="rounded border bg-muted/30 text-xs">
      <button
        className="flex items-center gap-2 w-full px-2 py-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        )}
        <span className="font-medium truncate">{name}</span>
        {!expanded && (
          <span className="text-[10px] text-muted-foreground truncate ml-1">
            {preview}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t px-2 py-1.5 max-h-60 overflow-y-auto">
          <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-words">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---- Run row component ----

function RunRow({ run, isZh }: { run: TeamRun; isZh: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[run.status];
  const StatusIcon = config.icon;
  const nodeEntries = Object.entries(run.nodeStatuses);
  const doneCount = nodeEntries.filter(([, s]) => s === "done").length;

  return (
    <div className="border rounded-lg bg-card transition-colors hover:bg-muted/30">
      {/* Summary row */}
      <button
        className="flex items-center gap-3 w-full px-3 py-2.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status icon */}
        <StatusIcon
          className={`h-4 w-4 flex-shrink-0 ${
            run.status === "running" ? "animate-spin" : ""
          } ${
            run.status === "completed"
              ? "text-emerald-500"
              : run.status === "error"
                ? "text-red-500"
                : run.status === "aborted"
                  ? "text-zinc-500"
                  : "text-amber-500"
          }`}
        />

        {/* Timestamp + duration */}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium truncate">
            {formatTimestamp(run.startedAt)}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatDuration(run.startedAt, run.completedAt)}
            </span>
            <span className="flex items-center gap-0.5">
              <Users className="h-2.5 w-2.5" />
              {doneCount}/{nodeEntries.length} {isZh ? "个成员" : "members"}
            </span>
            {run.totalTokens != null && run.totalTokens > 0 && (
              <span>{run.totalTokens.toLocaleString()} tokens</span>
            )}
          </div>
        </div>

        {/* Status badge */}
        <Badge variant="secondary" className={`text-[10px] ${config.color}`}>
          {isZh ? config.labelZh : config.label}
        </Badge>

        {/* Expand icon */}
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t px-3 py-2.5 space-y-3">
          {/* Per-agent statuses */}
          {nodeEntries.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {isZh ? "Agent 状态" : "Agent Statuses"}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {nodeEntries.map(([nodeId, status]) => (
                  <div
                    key={nodeId}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 text-xs"
                  >
                    <div
                      className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                        status === "done"
                          ? "bg-emerald-500"
                          : status === "error"
                            ? "bg-red-500"
                            : status === "running"
                              ? "bg-amber-500"
                              : status === "queued"
                                ? "bg-blue-500"
                                : "bg-zinc-400"
                      }`}
                    />
                    <span className="truncate font-mono text-[10px]">
                      {run.nodeNames?.[nodeId] ?? (nodeId.length > 20 ? nodeId.slice(0, 20) + "..." : nodeId)}
                    </span>
                    <span
                      className={`ml-auto text-[10px] ${NODE_STATUS_COLORS[status]}`}
                    >
                      {status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Logs */}
          {run.logs.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {isZh ? "执行日志" : "Execution Logs"}
              </div>
              <div className="max-h-40 overflow-y-auto rounded border bg-muted/30 p-2">
                {run.logs.slice(-20).map((log, i) => (
                  <div
                    key={i}
                    className="text-[10px] font-mono text-muted-foreground leading-relaxed"
                  >
                    {log}
                  </div>
                ))}
                {run.logs.length > 20 && (
                  <div className="text-[10px] text-muted-foreground/60 mt-1">
                    ... {run.logs.length - 20} {isZh ? "条更早的日志" : "earlier entries"}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Agent Outputs */}
          {run.nodeOutputs && Object.keys(run.nodeOutputs).length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {isZh ? "Agent 输出" : "Agent Outputs"}
              </div>
              <div className="space-y-1.5">
                {Object.entries(run.nodeOutputs).map(([nodeId, output]) => (
                  <AgentOutputEntry
                    key={nodeId}
                    name={run.nodeNames?.[nodeId] ?? nodeId}
                    output={output}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Cost info */}
          {(run.totalTokens != null || run.totalCost != null) && (
            <div className="flex gap-4 text-[10px] text-muted-foreground">
              {run.totalTokens != null && (
                <span>
                  Tokens: <strong>{run.totalTokens.toLocaleString()}</strong>
                </span>
              )}
              {run.totalCost != null && (
                <span>
                  {isZh ? "费用" : "Cost"}: <strong>${run.totalCost.toFixed(4)}</strong>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main Runs Panel ----

interface RunsPanelProps {
  teamId: string;
  isZh: boolean;
}

export function RunsPanel({ teamId, isZh }: RunsPanelProps) {
  const [runs, setRuns] = useState<TeamRun[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTeamRuns(teamId);
      // Sort newest first
      const sorted = [...data].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      setRuns(sorted);
    } catch {
      setRuns([]);
    }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          {isZh ? "暂无执行记录" : "No execution runs yet"}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1 max-w-[240px]">
          {isZh
            ? "在画布中运行团队后，执行记录将在此处显示。"
            : "Run the team from the canvas to see execution history here."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          {runs.length} {isZh ? "条记录" : runs.length === 1 ? "run" : "runs"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2"
          onClick={loadRuns}
        >
          {isZh ? "刷新" : "Refresh"}
        </Button>
      </div>
      <div className="space-y-1.5">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} isZh={isZh} />
        ))}
      </div>
    </div>
  );
}
