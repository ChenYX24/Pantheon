"use client";

import React, { useState, useCallback } from "react";
import {
  Github,
  BookOpen,
  Rss,
  FileText,
  Search,
  ChevronDown,
  ChevronUp,
  Youtube,
  TrendingUp,
  Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BriefingItem } from "../types";
import { BriefingCard } from "./briefing-card";

const SOURCE_ICONS: Record<string, typeof Github> = {
  github: Github,
  huggingface: BookOpen,
  arxiv: FileText,
  rss: Rss,
  "web-search": Search,
  rsshub: Rss,
  youtube: Youtube,
  finance: TrendingUp,
  "custom-api": Plug,
};

const SOURCE_LABELS: Record<string, { en: string; zh: string }> = {
  github: { en: "GitHub Trending", zh: "GitHub 热门" },
  huggingface: { en: "HuggingFace Papers", zh: "HuggingFace 论文" },
  arxiv: { en: "arXiv Papers", zh: "arXiv 论文" },
  rss: { en: "RSS Feeds", zh: "RSS 订阅" },
  rsshub: { en: "RSSHub Feeds", zh: "RSSHub 订阅" },
  "web-search": { en: "Web Search", zh: "网页搜索" },
  youtube: { en: "YouTube", zh: "YouTube" },
  finance: { en: "Finance", zh: "财经" },
  "custom-api": { en: "Custom API", zh: "自定义 API" },
};

const DEFAULT_VISIBLE_COUNT = 8;

interface BriefingGroupProps {
  readonly sourceType: string;
  readonly items: readonly BriefingItem[];
  readonly viewMode: "list" | "grid";
  readonly isZh: boolean;
  readonly needsMap: ReadonlyMap<string, string>;
  readonly onFeedback: (itemId: string, feedback: "good" | "bad" | "star") => void;
  readonly onMarkRead: (itemId: string) => void;
}

function BriefingGroupInner({
  sourceType,
  items,
  viewMode,
  isZh,
  needsMap,
  onFeedback,
  onMarkRead,
}: BriefingGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const Icon = SOURCE_ICONS[sourceType] ?? FileText;
  const label = SOURCE_LABELS[sourceType]
    ? (isZh ? SOURCE_LABELS[sourceType].zh : SOURCE_LABELS[sourceType].en)
    : sourceType;

  const visibleItems = expanded ? items : items.slice(0, DEFAULT_VISIBLE_COUNT);
  const hasMore = items.length > DEFAULT_VISIBLE_COUNT;

  const toggleCollapse = useCallback(() => setCollapsed((p) => !p), []);
  const toggleExpand = useCallback(() => setExpanded((p) => !p), []);

  return (
    <section className="space-y-2">
      {/* Group Header */}
      <button
        type="button"
        className="flex items-center gap-2 w-full group cursor-pointer py-1"
        onClick={toggleCollapse}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm truncate">{label}</span>
          <Badge variant="secondary" className="h-5 min-w-[1.5rem] px-1.5 text-[11px] shrink-0">
            {items.length}
          </Badge>
        </div>
        <div className="flex-1 border-b border-border/50 mx-2" />
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:text-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 transition-transform group-hover:text-foreground" />
        )}
      </button>

      {/* Cards */}
      {!collapsed && (
        <>
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 gap-3"
                : "space-y-2"
            }
          >
            {visibleItems.map((item) => (
              <BriefingCard
                key={item.id}
                item={item}
                needName={needsMap.get(item.needId)}
                isZh={isZh}
                viewMode={viewMode}
                onFeedback={onFeedback}
                onMarkRead={onMarkRead}
              />
            ))}
          </div>

          {/* Show more / Show less */}
          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
                onClick={toggleExpand}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    {isZh
                      ? `收起（显示 ${DEFAULT_VISIBLE_COUNT} 条）`
                      : `Show less (${DEFAULT_VISIBLE_COUNT})`}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    {isZh
                      ? `展开全部（${items.length} 条）`
                      : `Show all ${items.length} items`}
                  </>
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export const BriefingGroup = React.memo(BriefingGroupInner);
