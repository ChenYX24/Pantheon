"use client";

import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LayoutGrid,
  Maximize2,
  Save,
  Play,
  Trash2,
  Plus,
  Check,
  Square,
} from "lucide-react";

export interface FlowToolbarProps {
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onRun: () => void;
  onStop: () => void;
  onNew: () => void;
  onDelete: () => void;
  hasNodes: boolean;
  isRunning: boolean;
  saveStatus: "idle" | "saved";
  isZh?: boolean;
  /** Extra buttons rendered between layout controls and the spacer */
  children?: ReactNode;
}

/**
 * Shared toolbar for flow canvases.
 * Provides name input, layout, save, run/stop, new, and delete actions.
 * Plugin-specific buttons can be injected via children.
 */
export const FlowToolbar = memo(function FlowToolbar({
  name,
  onNameChange,
  onSave,
  onAutoLayout,
  onFitView,
  onRun,
  onStop,
  onNew,
  onDelete,
  hasNodes,
  isRunning,
  saveStatus,
  isZh = false,
  children,
}: FlowToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-background flex-wrap">
      {/* Name input */}
      <Input
        className="h-7 text-xs w-40 font-semibold"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={isZh ? "名称" : "Name"}
      />

      {/* Plugin-specific controls */}
      {children}

      <div className="h-4 w-px bg-border hidden sm:block" />

      {/* Layout controls */}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        onClick={onAutoLayout}
        disabled={!hasNodes}
        title={isZh ? "自动布局" : "Auto Layout"}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        onClick={onFitView}
        disabled={!hasNodes}
        title={isZh ? "适应视图" : "Fit View"}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* New */}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        onClick={onNew}
        title={isZh ? "新建" : "New"}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>

      {/* Save */}
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2.5 text-xs gap-1"
        onClick={onSave}
      >
        {saveStatus === "saved" ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Save className="h-3 w-3" />
        )}
        <span className="hidden sm:inline">
          {saveStatus === "saved"
            ? isZh
              ? "已保存"
              : "Saved"
            : isZh
              ? "保存"
              : "Save"}
        </span>
      </Button>

      {/* Run / Stop */}
      {isRunning ? (
        <Button
          size="sm"
          variant="destructive"
          className="h-7 px-2.5 text-xs gap-1"
          onClick={onStop}
        >
          <Square className="h-3 w-3" />
          <span className="hidden sm:inline">
            {isZh ? "停止" : "Stop"}
          </span>
        </Button>
      ) : (
        <Button
          size="sm"
          className="h-7 px-2.5 text-xs gap-1"
          onClick={onRun}
          disabled={!hasNodes}
        >
          <Play className="h-3 w-3" />
          <span className="hidden sm:inline">
            {isZh ? "运行" : "Run"}
          </span>
        </Button>
      )}

      {/* Delete */}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-red-500 hover:text-red-600"
        onClick={onDelete}
        title={isZh ? "删除" : "Delete"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
});
