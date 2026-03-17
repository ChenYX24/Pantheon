"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Terminal,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import type { Pipeline, NodeStatus } from "../types";
import { buildPipelineCommands } from "../lib/build-pipeline-commands";

interface ExecutionMonitorProps {
  pipeline: Pipeline;
  isZh: boolean;
}

const STATUS_ICON: Record<NodeStatus, React.ReactNode> = {
  idle: <Clock className="h-3 w-3 text-muted-foreground" />,
  queued: <Clock className="h-3 w-3 text-blue-400" />,
  running: <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />,
  done: <CheckCircle className="h-3 w-3 text-green-500" />,
  error: <XCircle className="h-3 w-3 text-red-500" />,
  skipped: <Clock className="h-3 w-3 text-muted-foreground/40" />,
};

export function ExecutionMonitor({ pipeline, isZh }: ExecutionMonitorProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const commands = useMemo(
    () => buildPipelineCommands(pipeline),
    [pipeline]
  );

  const handleCopyAll = () => {
    const script = commands
      .map((c, i) => `# Step ${i + 1}: ${c.skillName}\n${c.command}`)
      .join("\n\n");
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyTerminal = () => {
    const script = commands
      .map((c) => c.command)
      .join(" && ");
    const cmd = `screen -dmS aris-pipeline bash -c 'claude "${script}"'`;
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (commands.length === 0) return null;

  return (
    <div className="border-t bg-background">
      <button
        className="flex items-center justify-between w-full px-3 py-2 hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" />
          {isZh ? "执行计划" : "Execution Plan"}
          <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">
            {commands.length} {isZh ? "步" : "steps"}
          </Badge>
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Command list */}
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {commands.map((cmd, i) => {
              const nodeStatus = pipeline.nodes.find((n) => n.id === cmd.nodeId)?.status ?? "idle";
              return (
                <div
                  key={cmd.nodeId}
                  className="flex items-start gap-2 bg-muted/50 rounded-md px-2.5 py-1.5"
                >
                  <span className="text-[10px] text-muted-foreground font-mono mt-0.5 w-4 shrink-0">
                    {i + 1}
                  </span>
                  {STATUS_ICON[nodeStatus]}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium">{cmd.skillName}</div>
                    <code className="text-[10px] text-muted-foreground font-mono break-all">
                      {cmd.command}
                    </code>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 flex-1"
              onClick={handleCopyAll}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {isZh ? "复制命令序列" : "Copy Commands"}
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs gap-1 flex-1"
              onClick={handleCopyTerminal}
            >
              <Terminal className="h-3 w-3" />
              {isZh ? "复制 Screen 命令" : "Copy Screen Cmd"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
