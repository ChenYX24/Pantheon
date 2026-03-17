"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, ExternalLink, CheckCircle, Settings, Clock, Ban } from "lucide-react";
import type { SkillTreeNode, SkillStatus, SkillCategory } from "../types";
import { CATEGORIES } from "../skill-tree-data";

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
        <div className="flex items-center gap-1.5 mt-1">
          <Badge className={`${impl.color} border-0 text-[9px] px-1.5 py-0`}>
            {isZh ? impl.zh : impl.en}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0" style={{ borderColor: cat?.glowColor, color: cat?.glowColor }}>
            {isZh ? cat?.nameZh : cat?.name}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0">T{skill.tier}</Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isZh ? skill.descriptionZh : skill.description}
        </p>

        {/* Status control */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold">{isZh ? "状态" : "Status"}</label>
          <Select value={effectiveStatus} onValueChange={(v) => onStatusChange(skill.id, v as SkillStatus)}>
            <SelectTrigger className="h-8 text-xs">
              <div className="flex items-center gap-1.5">
                {STATUS_ICONS[effectiveStatus]}
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">
                <span className="flex items-center gap-1.5">{STATUS_ICONS.active} {isZh ? "已激活" : "Active"}</span>
              </SelectItem>
              <SelectItem value="configurable">
                <span className="flex items-center gap-1.5">{STATUS_ICONS.configurable} {isZh ? "需配置" : "Setup Needed"}</span>
              </SelectItem>
              <SelectItem value="planned">
                <span className="flex items-center gap-1.5">{STATUS_ICONS.planned} {isZh ? "规划中" : "Planned"}</span>
              </SelectItem>
              <SelectItem value="disabled">
                <span className="flex items-center gap-1.5">{STATUS_ICONS.disabled} {isZh ? "已禁用" : "Disabled"}</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Implementation detail */}
        {skill.implDetail && (
          <div className="space-y-1">
            <label className="text-[11px] font-semibold">{isZh ? "实现" : "Implementation"}</label>
            <code className="block text-[10px] text-muted-foreground font-mono bg-muted rounded px-2 py-1.5 break-all">
              {skill.implDetail}
            </code>
          </div>
        )}

        {/* Setup guide */}
        {skill.setupGuide && effectiveStatus === "configurable" && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5">
            <div className="text-[11px] font-semibold text-amber-400 mb-1">{isZh ? "配置指南" : "Setup Guide"}</div>
            <p className="text-[10px] text-muted-foreground">{skill.setupGuide}</p>
          </div>
        )}

        {/* Dependencies */}
        {deps.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">{isZh ? "依赖" : "Requires"}</label>
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
            <label className="text-[11px] font-semibold">{isZh ? "解锁" : "Unlocks"}</label>
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
