"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, AlertCircle } from "lucide-react";
import { ARIS_SKILLS } from "../skill-data";
import { buildCommand, getValidationErrors } from "../lib/build-pipeline-commands";
import { ParamInput } from "./param-input";
import type { PipelineNode } from "../types";

interface NodeConfigPanelProps {
  node: PipelineNode;
  onUpdate: (nodeId: string, patch: Partial<PipelineNode>) => void;
  onClose: () => void;
  isZh: boolean;
}

export function NodeConfigPanel({ node, onUpdate, onClose, isZh }: NodeConfigPanelProps) {
  const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
  if (!skill) return null;

  const params = skill.params ?? [];
  const errors = getValidationErrors(skill, node.paramValues);
  const command = buildCommand(skill, node.paramValues);

  const updateParam = (name: string, value: string) => {
    onUpdate(node.id, {
      paramValues: { ...node.paramValues, [name]: value },
    });
  };

  return (
    <div className="w-[300px] border-l bg-background flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div>
          <h3 className="text-sm font-semibold">{isZh ? skill.nameZh : skill.name}</h3>
          <code className="text-[10px] text-muted-foreground font-mono">{skill.command}</code>
        </div>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Description */}
        <p className="text-xs text-muted-foreground">
          {isZh ? skill.descriptionZh : skill.description}
        </p>

        {/* Dependencies */}
        {skill.dependencies && skill.dependencies.length > 0 && (
          <div>
            <span className="text-[11px] font-medium text-muted-foreground">
              {isZh ? "依赖" : "Dependencies"}
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {skill.dependencies.map((dep) => (
                <Badge key={dep} variant="outline" className="text-[10px] px-1.5 py-0">
                  {dep}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Parameters */}
        {params.length > 0 && (
          <div className="space-y-3">
            <span className="text-[11px] font-medium text-muted-foreground">
              {isZh ? "参数" : "Parameters"}
            </span>
            {params.map((param) => {
              const hasError = errors.includes(param.name);
              return (
                <div key={param.name} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">{param.name}</span>
                    {param.required && <span className="text-red-500 text-xs">*</span>}
                  </div>
                  <ParamInput
                    param={param}
                    value={node.paramValues[param.name] ?? ""}
                    onChange={(val) => updateParam(param.name, val)}
                    hasError={hasError}
                  />
                  {hasError && (
                    <div className="flex items-center gap-1 text-red-500 text-[10px]">
                      <AlertCircle className="h-2.5 w-2.5" />
                      {isZh ? "必填" : "Required"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Notes */}
        <div className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {isZh ? "备注 / 补充上下文" : "Notes / Extra context"}
          </span>
          <textarea
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[60px]"
            value={node.notes}
            onChange={(e) => onUpdate(node.id, { notes: e.target.value })}
            placeholder={isZh ? "添加你的思考、约束条件、参考链接..." : "Add your thoughts, constraints, reference links..."}
            rows={3}
          />
        </div>

        {/* Command preview */}
        <div className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {isZh ? "生成命令" : "Generated command"}
          </span>
          <div className="bg-muted rounded-md px-2 py-1.5 font-mono text-[11px] break-all select-all">
            {command}
          </div>
        </div>
      </div>
    </div>
  );
}
