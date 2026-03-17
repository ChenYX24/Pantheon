"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LayoutGrid, Maximize2, Save, Play, Trash2, Plus, Check, FolderOpen, Square, Loader2 } from "lucide-react";
import { PIPELINE_TEMPLATES } from "../pipeline-templates";
import { getPipelines } from "../pipeline-store";

interface PipelineToolbarProps {
  name: string;
  onNameChange: (name: string) => void;
  onLoadTemplate: (templateId: string) => void;
  onLoadSaved: (pipelineId: string) => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onSave: () => void;
  onRun: () => void;
  onStop: () => void;
  onNew: () => void;
  onDelete: () => void;
  hasNodes: boolean;
  isRunning: boolean;
  isZh: boolean;
  saveStatus: "idle" | "saved";
}

export function PipelineToolbar({
  name,
  onNameChange,
  onLoadTemplate,
  onLoadSaved,
  onAutoLayout,
  onFitView,
  onSave,
  onRun,
  onStop,
  onNew,
  onDelete,
  hasNodes,
  isRunning,
  isZh,
  saveStatus,
}: PipelineToolbarProps) {
  const saved = getPipelines();

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-background">
      {/* Pipeline name */}
      <Input
        className="h-7 text-xs w-40 font-semibold"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={isZh ? "流水线名称" : "Pipeline name"}
      />

      {/* Template selector */}
      <Select onValueChange={onLoadTemplate}>
        <SelectTrigger className="h-7 text-xs w-36">
          <SelectValue placeholder={isZh ? "模板..." : "Template..."} />
        </SelectTrigger>
        <SelectContent>
          {PIPELINE_TEMPLATES.map((tpl) => (
            <SelectItem key={tpl.id} value={tpl.id}>
              {isZh ? tpl.nameZh : tpl.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Load saved pipelines */}
      {saved.length > 0 && (
        <Select onValueChange={onLoadSaved}>
          <SelectTrigger className="h-7 text-xs w-36">
            <SelectValue placeholder={isZh ? "已保存..." : "Saved..."} />
          </SelectTrigger>
          <SelectContent>
            {saved.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="h-4 w-px bg-border" />

      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onAutoLayout} disabled={!hasNodes}>
        <LayoutGrid className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onFitView} disabled={!hasNodes}>
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>

      <div className="flex-1" />

      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onNew}>
        <Plus className="h-3.5 w-3.5" />
      </Button>

      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={onSave}>
        {saveStatus === "saved" ? <Check className="h-3 w-3 text-green-500" /> : <Save className="h-3 w-3" />}
        {saveStatus === "saved" ? (isZh ? "已保存" : "Saved") : (isZh ? "保存" : "Save")}
      </Button>

      {isRunning ? (
        <Button size="sm" variant="destructive" className="h-7 px-2.5 text-xs gap-1" onClick={onStop}>
          <Square className="h-3 w-3" />
          {isZh ? "停止" : "Stop"}
        </Button>
      ) : (
        <Button size="sm" className="h-7 px-2.5 text-xs gap-1" onClick={onRun} disabled={!hasNodes}>
          <Play className="h-3 w-3" />
          {isZh ? "运行" : "Run"}
        </Button>
      )}

      <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
