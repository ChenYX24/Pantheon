"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Flame,
} from "lucide-react";
import { TOOL_CONFIG, DEFAULT_TOOL_CONFIG } from "./conv-message";
import type { CategoryGroup, FileHotspot } from "@/lib/session-analysis";

// ─────────────── Category View ───────────────

export function CategoryView({
  categories,
  isZh,
}: {
  categories: CategoryGroup[];
  isZh: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(categories.map((c) => c.category)));

  const toggleCategory = (cat: string) => {
    const next = new Set(expanded);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpanded(next);
  };

  const categoryLabels: Record<string, string> = {
    Read: isZh ? "读取" : "Read",
    Write: isZh ? "写入" : "Write",
    Execute: isZh ? "执行" : "Execute",
    Web: isZh ? "网络" : "Web",
    Agent: isZh ? "代理" : "Agent",
    Other: isZh ? "其他" : "Other",
  };

  return (
    <div className="space-y-1">
      {categories.map((group) => {
        const isOpen = expanded.has(group.category);
        return (
          <div key={group.category} className="border rounded-md overflow-hidden">
            <button
              onClick={() => toggleCategory(group.category)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-muted/50 transition-colors text-left"
            >
              {isOpen ? (
                <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              )}
              <Layers className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium flex-1">
                {categoryLabels[group.category] || group.category}
              </span>
              <Badge variant="outline" className="text-[10px] h-4">
                {group.totalCalls}
              </Badge>
            </button>
            {isOpen && (
              <div className="border-t px-3 py-1.5 space-y-1 bg-muted/5">
                {group.tools.map((tool) => {
                  const config = TOOL_CONFIG[tool.name] || DEFAULT_TOOL_CONFIG;
                  const Icon = config.icon;
                  return (
                    <div key={tool.name} className="flex items-center gap-2 text-xs">
                      <Icon className={`h-3 w-3 ${config.color}`} />
                      <span className="font-mono flex-1">{tool.name}</span>
                      <span className="text-muted-foreground font-mono">{tool.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────── Hotspots Section ───────────────

export function HotspotsSection({
  hotspots,
  isZh,
}: {
  hotspots: FileHotspot[];
  isZh: boolean;
}) {
  if (hotspots.length === 0) return null;

  const top5 = hotspots.slice(0, 5);

  const getHeatBadge = (ops: number) => {
    if (ops > 10) return { label: `${ops}`, className: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400" };
    if (ops > 5) return { label: `${ops}`, className: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400" };
    if (ops > 2) return { label: `${ops}`, className: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400" };
    return { label: `${ops}`, className: "bg-zinc-100 dark:bg-zinc-900/40 text-zinc-600 dark:text-zinc-400" };
  };

  return (
    <div className="mb-3 p-2 border rounded-md bg-muted/10">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Flame className="h-3 w-3 text-orange-500" />
        <span className="text-xs font-medium">{isZh ? "热点文件" : "Hotspots"}</span>
      </div>
      <div className="space-y-1">
        {top5.map((spot) => {
          const fileName = spot.filePath.split(/[/\\]/).pop() || spot.filePath;
          const badge = getHeatBadge(spot.operations);
          return (
            <div key={spot.filePath} className="flex items-center gap-1.5 text-xs">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ${badge.className}`}>
                {badge.label}
              </span>
              <span className="font-mono truncate flex-1 text-muted-foreground" title={spot.filePath}>
                {fileName}
              </span>
              <span className="text-[10px] text-muted-foreground/60">{spot.lastTool}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
