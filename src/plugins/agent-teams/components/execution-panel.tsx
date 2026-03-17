"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronUp, ChevronDown, Square, Clock, Coins,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import type { AgentNodeStatus } from "./agent-node";

export interface ExecutionNodeStatus {
  nodeId: string;
  name: string;
  status: AgentNodeStatus;
  tokens?: number;
}

export interface ExecutionPanelProps {
  isRunning: boolean;
  logs: string[];
  nodeStatuses: ExecutionNodeStatus[];
  totalTokens: number;
  elapsedMs: number;
  onStop: () => void;
  isZh: boolean;
}

const STATUS_BADGE_STYLES: Record<AgentNodeStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  queued: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  running: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  skipped: "bg-muted text-muted-foreground/60",
};

const STATUS_ICONS: Record<AgentNodeStatus, React.ReactNode> = {
  idle: <Clock className="h-3 w-3" />,
  queued: <Clock className="h-3 w-3" />,
  running: <Loader2 className="h-3 w-3 animate-spin" />,
  done: <CheckCircle2 className="h-3 w-3" />,
  error: <XCircle className="h-3 w-3" />,
  skipped: <XCircle className="h-3 w-3" />,
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const remaining = s % 60;
  if (m > 0) return `${m}m ${remaining}s`;
  return `${s}s`;
}

export function ExecutionPanel({
  isRunning,
  logs,
  nodeStatuses,
  totalTokens,
  elapsedMs,
  onStop,
  isZh,
}: ExecutionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-expand when running starts
  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  // Auto-scroll logs
  useEffect(() => {
    if (expanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length, expanded]);

  const hasContent = logs.length > 0 || nodeStatuses.length > 0 || isRunning;
  if (!hasContent) return null;

  const doneCount = nodeStatuses.filter((n) => n.status === "done").length;
  const totalCount = nodeStatuses.length;

  return (
    <div className="border-t bg-background">
      {/* Toggle bar */}
      <button
        className="flex items-center justify-between w-full px-4 py-2 hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          <span className="text-xs font-semibold">
            {isZh ? "执行面板" : "Execution"}
          </span>
          {isRunning && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {isZh ? "运行中" : "Running"}
            </Badge>
          )}
          {!isRunning && doneCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {doneCount}/{totalCount} {isZh ? "已完成" : "done"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          {elapsedMs > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatElapsed(elapsedMs)}
            </span>
          )}
          {totalTokens > 0 && (
            <span className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {totalTokens.toLocaleString()}
            </span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="max-h-[200px] flex border-t">
          {/* Node status list */}
          {nodeStatuses.length > 0 && (
            <div className="w-[200px] border-r overflow-y-auto p-2 space-y-1">
              {nodeStatuses.map((ns) => (
                <div
                  key={ns.nodeId}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
                >
                  {STATUS_ICONS[ns.status]}
                  <span className="truncate flex-1 font-medium">{ns.name}</span>
                  {ns.tokens != null && ns.tokens > 0 && (
                    <span className="text-[9px] text-muted-foreground font-mono">
                      {ns.tokens.toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Log stream */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto bg-zinc-950/90 backdrop-blur-sm text-zinc-200 p-3 font-mono text-[11px] leading-relaxed">
              {logs.length === 0 ? (
                <span className="text-zinc-500">{isZh ? "等待日志..." : "Waiting for logs..."}</span>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={
                      log.includes("ERROR") || log.includes("error")
                        ? "text-red-400"
                        : log.includes("Done") || log.includes("Completed") || log.includes("Success")
                        ? "text-green-400"
                        : log.includes("===")
                        ? "text-blue-300 font-semibold"
                        : ""
                    }
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>

            {/* Stop button */}
            {isRunning && (
              <div className="px-3 py-1.5 border-t border-zinc-800 bg-zinc-950/90 flex justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={onStop}
                >
                  <Square className="h-3 w-3 mr-1" />
                  {isZh ? "停止" : "Stop"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
