"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Merge } from "lucide-react";

export interface AggregatorNodeData {
  label?: string;
  inputCount: number;
  isZh: boolean;
  [key: string]: unknown;
}

function AggregatorNodeInner({ data, selected }: NodeProps & { data: AggregatorNodeData }) {
  const label = data.label ?? (data.isZh ? "合并" : "Merge");
  const inputCount = data.inputCount ?? 0;

  return (
    <div className="relative w-[100px] h-[100px] flex items-center justify-center">
      {/* Target handle at top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background"
      />

      {/* Hexagonal shape via clip-path */}
      <div
        className={`
          w-[88px] h-[88px] flex flex-col items-center justify-center
          bg-background border-2 shadow-sm
          ${selected
            ? "border-primary ring-2 ring-primary/20 shadow-md"
            : "border-indigo-400/60 hover:border-indigo-400 hover:shadow-md"
          }
          transition-all duration-200
        `}
        style={{
          clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
        }}
      >
        <Merge className="h-5 w-5 text-indigo-500 mb-1" />
        <span className="text-[11px] font-semibold text-foreground">{label}</span>
        {inputCount > 0 && (
          <span className="text-[9px] text-muted-foreground mt-0.5">
            {inputCount} {data.isZh ? "输入" : "inputs"}
          </span>
        )}
      </div>

      {/* Source handle at bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2.5 !h-2.5 !border-2 !border-background"
      />
    </div>
  );
}

export const AggregatorNode = memo(AggregatorNodeInner);
