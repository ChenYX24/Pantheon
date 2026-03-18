"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X,
  ExternalLink,
  CheckCircle,
  Settings,
  Clock,
  Ban,
  ShieldCheck,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { SkillTreeNode, SkillStatus, SkillCategory } from "../types";
import { CATEGORIES } from "../skill-tree-data";

// ---------------------------------------------------------------------------
// Detect helper (shared with pages.tsx)
// ---------------------------------------------------------------------------

async function runDetect(command: string): Promise<{ success: boolean; output: string }> {
  try {
    const res = await fetch("/api/plugins/skill-tree/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    return await res.json();
  } catch {
    return { success: false, output: "Network error" };
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface SkillDetailPanelProps {
  skill: SkillTreeNode;
  effectiveStatus: SkillStatus;
  allSkills: SkillTreeNode[];
  onStatusChange: (skillId: string, status: SkillStatus) => void;
  onClose: () => void;
  onNavigate?: (route: string) => void;
  isZh: boolean;
}

const STATUS_ICONS: Record<SkillStatus, React.ReactNode> = {
  active: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />,
  configurable: <Settings className="h-3.5 w-3.5 text-amber-400" />,
  planned: <Clock className="h-3.5 w-3.5 text-zinc-400" />,
  disabled: <Ban className="h-3.5 w-3.5 text-zinc-600" />,
};

const STATUS_LABELS: Record<SkillStatus, { en: string; zh: string }> = {
  active: { en: "Active", zh: "已激活" },
  configurable: { en: "Setup Needed", zh: "需配置" },
  planned: { en: "Planned", zh: "规划中" },
  disabled: { en: "Disabled", zh: "已禁用" },
};

const IMPL_LABELS: Record<string, { en: string; zh: string; color: string }> = {
  cli: { en: "CLI Tool", zh: "CLI 工具", color: "bg-blue-500/10 text-blue-400" },
  skill: { en: "Claude Skill", zh: "Claude 技能", color: "bg-purple-500/10 text-purple-400" },
  mcp: { en: "MCP Server", zh: "MCP 服务器", color: "bg-green-500/10 text-green-400" },
  plugin: { en: "Dashboard Plugin", zh: "仪表盘插件", color: "bg-amber-500/10 text-amber-400" },
  api: { en: "API Integration", zh: "API 集成", color: "bg-cyan-500/10 text-cyan-400" },
  manual: { en: "Manual Setup", zh: "手动配置", color: "bg-zinc-500/10 text-zinc-400" },
  planned: { en: "Not Yet Built", zh: "尚未实现", color: "bg-zinc-500/10 text-zinc-500" },
};

function getCatMeta(cat: SkillCategory) {
  return CATEGORIES.find((c) => c.id === cat);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillDetailPanel({
  skill,
  effectiveStatus,
  allSkills,
  onStatusChange,
  onClose,
  onNavigate,
  isZh,
}: SkillDetailPanelProps) {
  const cat = getCatMeta(skill.category);
  const impl = IMPL_LABELS[skill.implType] ?? IMPL_LABELS.planned;
  const deps = skill.dependencies
    .map((id) => allSkills.find((s) => s.id === id))
    .filter(Boolean) as SkillTreeNode[];
  const unlocks = allSkills.filter((s) => s.dependencies.includes(skill.id));

  const canActivate =
    skill.defaultStatus === "active" || skill.defaultStatus === "configurable";
  const canDisable = effectiveStatus !== "planned";
  const statusLabel = STATUS_LABELS[effectiveStatus];

  // Detect state
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<{
    success: boolean;
    output: string;
  } | null>(null);

  const handleDetect = useCallback(async () => {
    if (!skill.detectCommand) return;
    setDetecting(true);
    setDetectResult(null);
    const result = await runDetect(skill.detectCommand);
    setDetectResult(result);
    setDetecting(false);
    if (result.success) {
      onStatusChange(skill.id, "active");
    }
  }, [skill, onStatusChange]);

  return (
    <div className="w-[300px] border-l bg-background/95 backdrop-blur-sm flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderLeftColor: cat?.glowColor, borderLeftWidth: 3 }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{isZh ? skill.nameZh : skill.name}</h3>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <Badge className={`${impl.color} border-0 text-[9px] px-1.5 py-0`}>
            {isZh ? impl.zh : impl.en}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0" style={{ borderColor: cat?.glowColor, color: cat?.glowColor }}>
            {isZh ? cat?.nameZh : cat?.name}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0">T{skill.tier}</Badge>
          <Badge
            className="text-[9px] px-1.5 py-0 border-0 gap-1"
            style={{
              backgroundColor: effectiveStatus === "active" ? "rgb(16 185 129 / 0.1)" :
                effectiveStatus === "configurable" ? "rgb(245 158 11 / 0.1)" : "rgb(113 113 122 / 0.1)",
            }}
          >
            {STATUS_ICONS[effectiveStatus]}
            {isZh ? statusLabel.zh : statusLabel.en}
          </Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isZh ? skill.descriptionZh : skill.description}
        </p>

        {/* Status actions — context-appropriate buttons instead of raw Select */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold">{isZh ? "操作" : "Actions"}</label>
          <div className="flex flex-wrap gap-1.5">
            {effectiveStatus === "disabled" && canActivate && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1"
                onClick={() =>
                  onStatusChange(
                    skill.id,
                    skill.defaultStatus === "active" ? "active" : "configurable"
                  )
                }
              >
                <CheckCircle className="h-3 w-3 text-emerald-400" />
                {isZh ? "重新启用" : "Re-enable"}
              </Button>
            )}
            {effectiveStatus === "active" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 text-zinc-400"
                onClick={() => onStatusChange(skill.id, "disabled")}
              >
                <Ban className="h-3 w-3" />
                {isZh ? "禁用" : "Disable"}
              </Button>
            )}
            {effectiveStatus === "planned" && (
              <div className="text-[10px] text-muted-foreground italic">
                {isZh ? "此功能尚未实现，开发后将自动可用" : "Not yet implemented. Available once built."}
              </div>
            )}
            {effectiveStatus === "configurable" && (
              <div className="text-[10px] text-amber-400">
                {isZh ? "需要配置后才能使用（见下方步骤）" : "Needs setup before use (see steps below)"}
              </div>
            )}
          </div>
        </div>

        {/* Detect button */}
        {skill.detectCommand && (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full h-8 text-xs gap-1.5 border-sky-500/20 hover:border-sky-500/40 text-sky-400 hover:text-sky-300"
              onClick={handleDetect}
              disabled={detecting}
            >
              {detecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {detecting
                ? (isZh ? "检测中..." : "Verifying...")
                : (isZh ? "检测配置" : "Verify Setup")}
            </Button>

            {detectResult && (
              <div
                className={`rounded-lg border p-2.5 text-[10px] space-y-1 transition-all duration-300 animate-in fade-in slide-in-from-top-1 ${
                  detectResult.success
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-red-500/5 border-red-500/20"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {detectResult.success ? (
                    <CheckCircle className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-red-400" />
                  )}
                  <span
                    className={
                      detectResult.success
                        ? "text-emerald-400 font-medium"
                        : "text-red-400 font-medium"
                    }
                  >
                    {detectResult.success
                      ? (isZh ? "验证成功！" : "Verified!")
                      : (isZh ? "验证失败" : "Verification failed")}
                  </span>
                </div>
                {detectResult.output && (
                  <code className="block text-[9px] font-mono text-muted-foreground bg-muted rounded px-2 py-1 break-all max-h-20 overflow-y-auto">
                    {detectResult.output}
                  </code>
                )}
                {!detectResult.success && skill.detectHint && (
                  <div className="text-muted-foreground mt-1">
                    <span className="font-medium text-amber-400">
                      {isZh ? "提示：" : "Hint: "}
                    </span>
                    {skill.detectHint}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Setup steps */}
        {skill.setupSteps && skill.setupSteps.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 space-y-2">
            <div className="text-[11px] font-semibold text-amber-400">
              {isZh ? "配置步骤" : "Setup Steps"}
            </div>
            <ol className="space-y-1.5">
              {skill.setupSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-[10px]">
                  <span className="text-amber-500 font-mono shrink-0">{i + 1}.</span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
            {skill.detectHint && (
              <div className="text-[10px] text-muted-foreground border-t border-amber-500/10 pt-1.5 mt-1.5">
                <span className="font-medium text-amber-400">
                  {isZh ? "验证：" : "Verify: "}
                </span>
                {skill.detectHint}
              </div>
            )}
            {skill.detectCommand && (
              <code className="block text-[9px] font-mono bg-zinc-900 text-zinc-300 rounded px-2 py-1 mt-1">
                $ {skill.detectCommand}
              </code>
            )}
          </div>
        )}

        {/* Implementation detail */}
        {skill.implDetail && (
          <div className="space-y-1">
            <label className="text-[11px] font-semibold">{isZh ? "实现" : "Implementation"}</label>
            <code className="block text-[10px] text-muted-foreground font-mono bg-muted rounded px-2 py-1.5 break-all">
              {skill.implDetail}
            </code>
          </div>
        )}

        {/* Dependencies */}
        {deps.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">{isZh ? "前置依赖" : "Requires"}</label>
            <div className="flex flex-wrap gap-1">
              {deps.map((d) => (
                <Badge key={d.id} variant="outline" className="text-[9px] px-1.5 py-0 cursor-pointer hover:bg-accent">
                  {isZh ? d.nameZh : d.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Unlocks */}
        {unlocks.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">{isZh ? "解锁技能" : "Unlocks"}</label>
            <div className="flex flex-wrap gap-1">
              {unlocks.map((u) => (
                <Badge key={u.id} variant="outline" className="text-[9px] px-1.5 py-0 cursor-pointer hover:bg-accent">
                  {isZh ? u.nameZh : u.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skill.tags.map((t) => (
              <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* Navigate to page */}
        {skill.pageRoute && (
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-xs gap-1.5"
            onClick={() => onNavigate?.(skill.pageRoute!)}
          >
            <ExternalLink className="h-3 w-3" />
            {isZh ? "打开页面" : "Open Page"}
          </Button>
        )}
      </div>
    </div>
  );
}
