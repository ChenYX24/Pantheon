"use client";

import { useState, useEffect, useRef } from "react";
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
  /** Agent outputs collected during execution */
  nodeOutputs?: Record<string, string>;
}

const STATUS_ICONS: Record<AgentNodeStatus, React.ReactNode> = {
  idle: <Clock className="h-3 w-3" />,
  queued: <Clock className="h-3 w-3" />,
  running: <Loader2 className="h-3 w-3 animate-spin" />,
  done: <CheckCircle2 className="h-3 w-3" />,
  error: <XCircle className="h-3 w-3" />,
  skipped: <XCircle className="h-3 w-3" />,
};

function OutputEntry({ name, output, isZh }: { name: string; output?: string; isZh: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!output) {
    return (
      <div className="px-3 py-2 border-b border-zinc-800/50 last:border-b-0">
        <div className="text-[11px] font-medium text-zinc-400">{name}</div>
        <div className="text-[10px] text-zinc-600 italic mt-0.5">
          {isZh ? "等待中..." : "Pending..."}
        </div>
      </div>
    );
  }
  const preview = output.length > 150 ? output.slice(0, 150) + "..." : output;
  return (
    <div className="px-3 py-2 border-b border-zinc-800/50 last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-zinc-300">{name}</div>
        {output.length > 150 && (
          <button
            className="text-[10px] text-blue-400 hover:text-blue-300"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (isZh ? "收起" : "Less") : (isZh ? "展开" : "More")}
          </button>
        )}
      </div>
      <pre className="text-[10px] text-zinc-400 mt-1 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-[200px] overflow-y-auto">
        {expanded ? output : preview}
      </pre>
    </div>
  );
}

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
  nodeOutputs,
}: ExecutionPanelProps) {
  const [manualExpanded, setManualExpanded] = useState(false);
  const [manualTab, setManualTab] = useState<"logs" | "outputs" | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Derived state: auto-expand when running, allow manual toggle
  const expanded = isRunning || manualExpanded;
  const setExpanded = setManualExpanded;

  const doneCount = nodeStatuses.filter((n) => n.status === "done").length;
  const totalCount = nodeStatuses.length;
  const allDone = !isRunning && doneCount > 0 && doneCount === totalCount;

  // Derived tab: show outputs when done, unless user manually switched
  const activeTab = manualTab ?? (allDone ? "outputs" : "logs");
  const setActiveTab = setManualTab;

  // Auto-scroll logs
  useEffect(() => {
    if (expanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length, expanded]);

  const hasContent = logs.length > 0 || nodeStatuses.length > 0 || isRunning;
  if (!hasContent) return null;

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

          {/* Tabbed right panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Tab bar */}
            <div className="flex border-b border-zinc-800 bg-zinc-950/90">
              <button
                className={`px-3 py-1 text-[10px] font-medium border-b-2 transition-colors ${
                  activeTab === "logs"
                    ? "border-blue-400 text-blue-400"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
                onClick={() => setActiveTab("logs")}
              >
                {isZh ? "日志" : "Logs"} ({logs.length})
              </button>
              <button
                className={`px-3 py-1 text-[10px] font-medium border-b-2 transition-colors ${
                  activeTab === "outputs"
                    ? "border-blue-400 text-blue-400"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
                onClick={() => setActiveTab("outputs")}
              >
                {isZh ? "输出" : "Outputs"} ({Object.keys(nodeOutputs ?? {}).length})
              </button>
            </div>

            {/* Tab content */}
            {activeTab === "logs" ? (
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
            ) : (
              <div className="flex-1 overflow-y-auto bg-zinc-950/90 backdrop-blur-sm">
                {nodeStatuses.length === 0 ? (
                  <div className="p-3 text-zinc-500 text-[11px]">
                    {isZh ? "暂无输出" : "No outputs yet"}
                  </div>
                ) : (
                  nodeStatuses.map((ns) => (
                    <OutputEntry
                      key={ns.nodeId}
                      name={ns.name}
                      output={nodeOutputs?.[ns.nodeId]}
                      isZh={isZh}
                    />
                  ))
                )}
              </div>
            )}

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
