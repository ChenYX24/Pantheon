"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Check, X, Clock, Brain, Layers, Globe,
  Shield, Code2, Search, TestTube, PenTool,
} from "lucide-react";

/** Node status — mirrors pipeline palette */
export type AgentNodeStatus = "idle" | "queued" | "running" | "done" | "error" | "skipped";

const STATUS_STYLES: Record<AgentNodeStatus, string> = {
  idle: "border-l-muted-foreground/40",
  queued: "border-l-blue-400",
  running: "border-l-amber-400 animate-pulse",
  done: "border-l-green-500",
  error: "border-l-red-500",
  skipped: "border-l-muted-foreground/20",
};

const STATUS_ICONS: Record<AgentNodeStatus, React.ReactNode> = {
  idle: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  queued: <Clock className="h-3.5 w-3.5 text-blue-400" />,
  running: <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />,
  done: <Check className="h-3.5 w-3.5 text-green-500" />,
  error: <X className="h-3.5 w-3.5 text-red-500" />,
  skipped: <X className="h-3.5 w-3.5 text-muted-foreground/40" />,
};

const PROVIDER_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  claude: {
    bg: "bg-orange-100 dark:bg-orange-900/30",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-200 dark:border-orange-800",
  },
  codex: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-200 dark:border-green-800",
  },
  api: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-200 dark:border-purple-800",
  },
};

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  claude: <Brain className="h-3 w-3" />,
  codex: <Layers className="h-3 w-3" />,
  api: <Globe className="h-3 w-3" />,
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  architect: <Shield className="h-4 w-4" />,
  developer: <Code2 className="h-4 w-4" />,
  reviewer: <Search className="h-4 w-4" />,
  tester: <TestTube className="h-4 w-4" />,
  writer: <PenTool className="h-4 w-4" />,
};

function getRoleIcon(role: string): React.ReactNode {
  const key = role.toLowerCase();
  for (const [k, icon] of Object.entries(ROLE_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return <Brain className="h-4 w-4" />;
}

export interface AgentNodeData {
  memberId: string;
  name: string;
  role: string;
  provider: string;
  model: string;
  status: AgentNodeStatus;
  tokens?: number;
  isZh: boolean;
  [key: string]: unknown;
}

function AgentNodeInner({ data, selected }: NodeProps & { data: AgentNodeData }) {
  const status = (data.status ?? "idle") as AgentNodeStatus;
  const provider = data.provider ?? "claude";
  const pStyle = PROVIDER_STYLES[provider] ?? PROVIDER_STYLES.api;
  const modelShort = (data.model ?? "unknown").length > 20
    ? (data.model ?? "unknown").slice(0, 18) + "..."
    : (data.model ?? "unknown");

  return (
    <div
      className={`
        bg-background border rounded-xl shadow-sm w-[260px]
        border-l-4 ${STATUS_STYLES[status]}
        ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md" : "hover:shadow-md"}
        transition-all duration-200
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background"
      />

      <div className="px-3.5 py-3">
        {/* Top row: avatar + name + status */}
        <div className="flex items-start gap-2.5 mb-2">
          {/* Avatar area */}
          <div className={`
            h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0
            ${pStyle.bg} ${pStyle.text}
          `}>
            {getRoleIcon(data.role ?? "")}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold truncate flex-1">
                {data.name ?? "Agent"}
              </span>
              {STATUS_ICONS[status]}
            </div>
            <span className="text-[11px] text-muted-foreground truncate block">
              {data.role ?? "Member"}
            </span>
          </div>
        </div>

        {/* Provider + model row */}
        <div className="flex items-center gap-1.5 mb-1">
          <Badge
            variant="secondary"
            className={`text-[10px] px-1.5 py-0 gap-1 ${pStyle.bg} ${pStyle.text} border ${pStyle.border}`}
          >
            {PROVIDER_ICONS[provider]}
            {provider}
          </Badge>
          <code className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded truncate flex-1">
            {modelShort}
          </code>
        </div>

        {/* Token counter (visible when running/done) */}
        {(status === "running" || status === "done") && data.tokens != null && (
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-dashed">
            <span className="text-[10px] text-muted-foreground">
              {data.isZh ? "令牌" : "Tokens"}
            </span>
            <span className={`text-[10px] font-mono ${status === "running" ? "text-amber-500" : "text-green-500"}`}>
              {(data.tokens ?? 0).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeInner);
