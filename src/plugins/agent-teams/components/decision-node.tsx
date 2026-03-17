"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export interface DecisionNodeData {
  condition: string;
  isZh: boolean;
  [key: string]: unknown;
}

function DecisionNodeInner({ data, selected }: NodeProps & { data: DecisionNodeData }) {
  const condition = data.condition ?? "?";

  return (
    <div className="relative w-[120px] h-[120px]">
      {/* Target handle at top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background !top-0 !left-1/2 !-translate-x-1/2"
      />

      {/* Diamond shape */}
      <div
        className={`
          absolute inset-[8px] rotate-45 rounded-lg
          bg-background border-2 shadow-sm
          ${selected
            ? "border-primary ring-2 ring-primary/20 shadow-md"
            : "border-amber-400/60 hover:border-amber-400 hover:shadow-md"
          }
          transition-all duration-200
        `}
      >
        {/* Counter-rotated content */}
        <div className="-rotate-45 flex flex-col items-center justify-center h-full px-2">
          <GitBranch className="h-4 w-4 text-amber-500 mb-1 flex-shrink-0" />
          <span className="text-[10px] font-medium text-center leading-tight line-clamp-2 text-foreground">
            {condition.length > 24 ? condition.slice(0, 22) + "..." : condition}
          </span>
        </div>
      </div>

      {/* Source handles: left = false, right = true, bottom = default */}
      <Handle
        type="source"
        position={Position.Left}
        id="false"
        className="!bg-red-400 !w-2 !h-2 !border-2 !border-background !left-0 !top-1/2 !-translate-y-1/2"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        className="!bg-green-400 !w-2 !h-2 !border-2 !border-background !right-0 !top-1/2 !-translate-y-1/2"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="default"
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background !bottom-0 !left-1/2 !-translate-x-1/2"
      />
    </div>
  );
}

export const DecisionNode = memo(DecisionNodeInner);
