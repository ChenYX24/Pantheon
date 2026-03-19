"use client";

import { Button } from "@/components/ui/button";
import { LayoutGrid, Maximize2, Save, Play, RotateCcw } from "lucide-react";

export interface CanvasToolbarProps {
  teamName: string;
  agentCount: number;
  isZh: boolean;
  isRunning: boolean;
  onAutoLayout: () => void;
  onFitView: () => void;
  onReset: () => void;
  onSave: () => void;
  onRun: () => void;
}

export function CanvasToolbar({
  teamName,
  agentCount,
  isZh,
  isRunning,
  onAutoLayout,
  onFitView,
  onReset,
  onSave,
  onRun,
}: CanvasToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold truncate max-w-[200px]">
          {teamName}
        </span>
        <span className="text-xs text-muted-foreground">
          {agentCount} {isZh ? "个成员" : "members"}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={onAutoLayout}
          title={isZh ? "自动布局" : "Auto Layout"}
        >
          <LayoutGrid className="h-3.5 w-3.5 mr-1" />
          {isZh ? "布局" : "Layout"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={onFitView}
          title={isZh ? "适应视图" : "Fit View"}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={onReset}
          title={isZh ? "重置状态" : "Reset"}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-5 bg-border mx-0.5" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={onSave}
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {isZh ? "保存" : "Save"}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs px-2"
          onClick={onRun}
          disabled={isRunning || agentCount === 0}
        >
          <Play className="h-3.5 w-3.5 mr-1" />
          {isZh ? "运行" : "Run"}
        </Button>
      </div>
    </div>
  );
}
