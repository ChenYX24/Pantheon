"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Search, Lightbulb, FlaskConical, FileText, Wrench, Loader2, Check, X, Clock } from "lucide-react";
import type { NodeStatus } from "../types";
import { ARIS_SKILLS } from "../skill-data";

const STATUS_STYLES: Record<NodeStatus, string> = {
  idle: "border-l-muted-foreground/40",
  queued: "border-l-blue-400",
  running: "border-l-amber-400 animate-pulse",
  done: "border-l-green-500",
  error: "border-l-red-500",
  skipped: "border-l-muted-foreground/20",
};

const STATUS_ICONS: Record<NodeStatus, React.ReactNode> = {
  idle: <Clock className="h-3 w-3 text-muted-foreground" />,
  queued: <Clock className="h-3 w-3 text-blue-400" />,
  running: <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />,
  done: <Check className="h-3 w-3 text-green-500" />,
  error: <X className="h-3 w-3 text-red-500" />,
  skipped: <X className="h-3 w-3 text-muted-foreground/40" />,
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  workflow: <FlaskConical className="h-3.5 w-3.5" />,
  research: <Search className="h-3.5 w-3.5" />,
  experiment: <FlaskConical className="h-3.5 w-3.5" />,
  paper: <FileText className="h-3.5 w-3.5" />,
  utility: <Wrench className="h-3.5 w-3.5" />,
};

interface SkillNodeData {
  skillId: string;
  status: NodeStatus;
  paramValues: Record<string, string>;
  notes: string;
  isZh: boolean;
  [key: string]: unknown;
}

function SkillNodeInner({ data, selected }: NodeProps & { data: SkillNodeData }) {
  const skill = ARIS_SKILLS.find((s) => s.id === data.skillId);
  if (!skill) return <div className="p-2 text-xs text-red-500">Unknown skill</div>;

  const status = data.status ?? "idle";
  const filledParams = Object.values(data.paramValues ?? {}).filter(Boolean).length;
  const totalParams = skill.params?.length ?? 0;

  return (
    <div
      className={`
        bg-background border rounded-lg shadow-sm w-[220px]
        border-l-4 ${STATUS_STYLES[status]}
        ${selected ? "ring-2 ring-primary ring-offset-1" : "hover:shadow-md"}
        transition-all
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />

      <div className="px-3 py-2.5">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1">
          {CATEGORY_ICONS[skill.category] ?? CATEGORY_ICONS.utility}
          <span className="text-xs font-semibold truncate flex-1">
            {data.isZh ? skill.nameZh : skill.name}
          </span>
          {STATUS_ICONS[status]}
        </div>

        {/* Command + param info */}
        <div className="flex items-center justify-between">
          <code className="text-[10px] text-muted-foreground font-mono bg-muted px-1 py-0.5 rounded truncate max-w-[140px]">
            {skill.command}
          </code>
          {totalParams > 0 && (
            <span className={`text-[10px] ${filledParams === totalParams ? "text-green-600" : "text-muted-foreground"}`}>
              {filledParams}/{totalParams}
            </span>
          )}
        </div>

        {/* Notes indicator */}
        {data.notes && (
          <div className="mt-1 text-[10px] text-muted-foreground truncate italic">
            {data.notes.slice(0, 30)}...
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

export const SkillNode = memo(SkillNodeInner);
export const nodeTypes = { skill: SkillNode };
