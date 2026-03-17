"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  FlaskConical,
  FolderOpen,
} from "lucide-react";

interface ContextBarProps {
  name: string;
  onNameChange: (name: string) => void;
  workspacePath: string | null;
  workspaceName: string | null;
  phase: "setup" | "design" | "execute";
  isZh: boolean;
  onBackToSetup: () => void;
  /** Brief research direction summary (1 line, truncated) */
  researchBrief?: string;
}

const PHASE_CONFIG = {
  setup: {
    label: "Setup",
    labelZh: "设置",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700",
  },
  design: {
    label: "Design",
    labelZh: "设计",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 dark:border-blue-700",
  },
  execute: {
    label: "Execute",
    labelZh: "执行",
    className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300 dark:border-green-700",
  },
} as const;

export function ContextBar({
  name,
  onNameChange,
  workspacePath,
  workspaceName,
  phase,
  isZh,
  onBackToSetup,
  researchBrief,
}: ContextBarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync editValue when name prop changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(name);
    }
  }, [name, isEditing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onNameChange(trimmed);
    } else {
      setEditValue(name);
    }
  }, [editValue, name, onNameChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSave();
      } else if (e.key === "Escape") {
        setEditValue(name);
        setIsEditing(false);
      }
    },
    [handleSave, name],
  );

  const handleCopyPath = useCallback(async () => {
    if (!workspacePath) return;
    try {
      await navigator.clipboard.writeText(workspacePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }, [workspacePath]);

  const phaseConfig = PHASE_CONFIG[phase];
  const truncatedBrief =
    researchBrief && researchBrief.length > 60
      ? researchBrief.slice(0, 57) + "..."
      : researchBrief;

  return (
    <div className="flex items-center gap-3 px-3 h-10 border-b bg-muted/30 shrink-0">
      {/* Pipeline name (editable) */}
      <div className="flex items-center gap-1.5 min-w-0">
        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {isEditing ? (
          <input
            ref={inputRef}
            className="h-6 px-1.5 text-xs font-semibold bg-background border rounded w-44 outline-none focus:ring-1 focus:ring-ring"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <button
            className="text-xs font-semibold truncate max-w-[180px] hover:underline cursor-text"
            onClick={() => setIsEditing(true)}
            title={isZh ? "点击编辑名称" : "Click to edit name"}
          >
            {name || (isZh ? "未命名流水线" : "Untitled Pipeline")}
          </button>
        )}
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-border shrink-0" />

      {/* Workspace path chip */}
      <div className="flex items-center gap-1 min-w-0">
        <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" />
        {workspacePath ? (
          <div className="flex items-center gap-0.5">
            <button
              className="text-[11px] text-muted-foreground hover:text-foreground truncate max-w-[180px] font-mono transition-colors"
              onClick={handleCopyPath}
              title={workspacePath}
            >
              {workspaceName ?? workspacePath}
            </button>
            {copied ? (
              <Check className="h-3 w-3 text-green-500 shrink-0" />
            ) : (
              <Copy
                className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground cursor-pointer shrink-0"
                onClick={handleCopyPath}
              />
            )}
            <a
              href={`vscode://file/${workspacePath}`}
              title={isZh ? "在编辑器中打开" : "Open in editor"}
              className="hover:text-foreground text-muted-foreground/50 transition-colors"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/60 italic">
            {isZh ? "尚未创建工作区" : "No workspace yet"}
          </span>
        )}
      </div>

      {/* Research brief (if provided) */}
      {truncatedBrief && (
        <>
          <div className="h-4 w-px bg-border shrink-0" />
          <span
            className="text-[11px] text-muted-foreground truncate max-w-[200px]"
            title={researchBrief}
          >
            {truncatedBrief}
          </span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Phase badge */}
      <Badge
        variant="outline"
        className={`text-[10px] px-2 py-0 h-5 font-medium shrink-0 ${phaseConfig.className}`}
      >
        {isZh ? phaseConfig.labelZh : phaseConfig.label}
      </Badge>

      {/* Back to Setup button */}
      {phase !== "setup" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
          onClick={onBackToSetup}
        >
          <ArrowLeft className="h-3 w-3" />
          {isZh ? "设置" : "Setup"}
        </Button>
      )}
    </div>
  );
}
