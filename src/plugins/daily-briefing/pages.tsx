"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Newspaper,
  RefreshCw,
  Settings,
  Loader2,
  Github,
  BookOpen,
  Rss,
  FileText,
  Search,
  Inbox,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Sparkles,
  LayoutList,
  LayoutGrid,
  Youtube,
  TrendingUp,
  Plug,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { useLocale } from "@/i18n/provider";
import { useToast } from "@/components/toast";
import type { InfoNeed, DailyBriefing, BriefingItem } from "./types";
import { BriefingCard } from "./components/briefing-card";
import { BriefingGroup } from "./components/briefing-group";
import { NeedsManager } from "./components/needs-manager";
import { NeedCreatorDialog } from "./components/need-creator-dialog";
import { BriefingSettings } from "./components/briefing-settings";

const ITEMS_PER_PAGE = 20;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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

export function DailyBriefingPage() {
  const t = useTranslations("dailyBriefing");
  const { locale } = useLocale();
  const isZh = locale === "zh-CN";
  const { toast } = useToast();

  const [date, setDate] = useState(todayStr);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [needs, setNeeds] = useState<InfoNeed[]>([]);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [activeNeedId, setActiveNeedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [pushing, setPushing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Load needs via API
  const loadNeeds = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins/daily-briefing/needs");
      if (res.ok) {
        const data = await res.json();
        setNeeds(data.needs ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  // Load briefing for date via API
  const loadBriefing = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/plugins/daily-briefing/items?date=${d}`);
      if (res.ok) {
        const data = await res.json();
        setBriefing(data.briefing ?? null);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadNeeds(); }, [loadNeeds]);
  useEffect(() => { loadBriefing(date); }, [date, loadBriefing]);

  // Fetch new content
  const handleFetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plugins/daily-briefing/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await loadBriefing(date);
      }
    } catch (err) {
      console.error("[DailyBriefing] Fetch error:", err);
    }
    setLoading(false);
  }, [date, loadBriefing]);

  // Push briefing to channels
  const handlePush = useCallback(async () => {
    setPushing(true);
    try {
      const res = await fetch("/api/plugins/daily-briefing/push", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || (isZh ? "推送失败" : "Push failed"), "error");
      } else if (data.failCount > 0 && data.successCount === 0) {
        toast(isZh ? "全部推送失败" : "All pushes failed", "error");
      } else if (data.failCount > 0) {
        toast(
          isZh
            ? `部分推送成功（${data.successCount} 成功，${data.failCount} 失败）`
            : `Partial success (${data.successCount} ok, ${data.failCount} failed)`,
          "info",
        );
      } else {
        toast(
          isZh
            ? `推送成功（${data.successCount} 个频道）`
            : `Pushed to ${data.successCount} channel(s)`,
          "success",
        );
      }
    } catch (err) {
      console.error("[DailyBriefing] Push error:", err);
      toast(isZh ? "推送失败" : "Push failed", "error");
    }
    setPushing(false);
  }, [isZh, toast]);

  // Feedback
  const handleFeedback = useCallback(async (itemId: string, feedback: "good" | "bad" | "star") => {
    try {
      await fetch("/api/plugins/daily-briefing/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, date, feedback }),
      });
      setBriefing((prev) => prev ? {
        ...prev,
        items: prev.items.map((i) => i.id === itemId
          ? { ...i, userFeedback: feedback, isFavorite: feedback === "star" ? !i.isFavorite : i.isFavorite }
          : i),
      } : null);
    } catch { /* ignore */ }
  }, [date]);

  const handleMarkRead = useCallback((itemId: string) => {
    setBriefing((prev) => prev ? {
      ...prev,
      items: prev.items.map((i) => i.id === itemId ? { ...i, isRead: true } : i),
    } : null);
  }, []);

  // Items filtered by active need tab
  const needFilteredItems = useMemo(() => {
    if (!briefing) return [];
    if (activeNeedId === null) return briefing.items;
    return briefing.items.filter((i) => i.needId === activeNeedId);
  }, [briefing, activeNeedId]);

  // Filtered items (source filter + search applied on top of need filter)
  const filteredItems = useMemo(() => {
    let items = needFilteredItems;
    if (activeFilter !== "all") {
      items = items.filter((i) => i.sourceType === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)) ||
        (i.author ?? "").toLowerCase().includes(q)
      );
    }
    return items;
  }, [needFilteredItems, activeFilter, searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeNeedId, activeFilter, searchQuery]);

  // Whether to show grouped view: "All" tab with no source filter and no search
  const isGroupedView = activeNeedId === null && activeFilter === "all" && !searchQuery.trim();

  // Group items by sourceType for grouped view
  const groupedItems = useMemo(() => {
    if (!isGroupedView) return new Map<string, BriefingItem[]>();
    const groups = new Map<string, BriefingItem[]>();
    for (const item of filteredItems) {
      const existing = groups.get(item.sourceType);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(item.sourceType, [item]);
      }
    }
    return groups;
  }, [isGroupedView, filteredItems]);

  // Paginated items for flat (non-grouped) view
  const paginatedItems = useMemo(() => {
    if (isGroupedView) return filteredItems;
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredItems.slice(start, start + ITEMS_PER_PAGE);
  }, [isGroupedView, filteredItems, currentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));

  // Map of needId -> needName for passing to BriefingGroup
  const needsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of needs) {
      map.set(n.id, n.name);
    }
    return map;
  }, [needs]);

  // Stats
  const stats = useMemo(() => {
    if (!briefing) return null;
    const bySource: Record<string, number> = {};
    for (const item of briefing.items) {
      bySource[item.sourceType] = (bySource[item.sourceType] ?? 0) + 1;
    }
    return { total: briefing.items.length, bySource };
  }, [briefing]);

  // Item counts per need (for tab badges)
  const needCounts = useMemo(() => {
    if (!briefing) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const item of briefing.items) {
      counts.set(item.needId, (counts.get(item.needId) ?? 0) + 1);
    }
    return counts;
  }, [briefing]);

  // Source types within current need tab
  const sourceTypes = useMemo(() => {
    return [...new Set(needFilteredItems.map((i) => i.sourceType))];
  }, [needFilteredItems]);

  // Active summary: per-need or global
  const activeSummary = useMemo(() => {
    if (!briefing) return null;
    if (activeNeedId === null) return briefing.summary ?? null;
    return briefing.summaries?.[activeNeedId] ?? null;
  }, [briefing, activeNeedId]);

  return (
    <div className="space-y-4 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Newspaper className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isZh ? "AI 驱动的个性化信息雷达" : "AI-powered personalized information radar"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setDate((d) => shiftDate(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-mono min-w-[90px] text-center">{date}</span>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= todayStr()}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleFetch} disabled={loading || needs.length === 0}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            {t("refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePush} disabled={pushing || !briefing || briefing.items.length === 0}>
            {pushing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
            {isZh ? "推送" : "Push"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreatorOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {isZh ? "新需求" : "New Need"}
          </Button>
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setConfigOpen(true)} title={isZh ? "设置" : "Settings"}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && stats.total > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">{stats.total} {isZh ? "条" : "items"}</Badge>
          {Object.entries(stats.bySource).map(([src, count]) => {
            const Icon = SOURCE_ICONS[src] ?? FileText;
            return (
              <Badge key={src} variant="secondary" className="text-xs gap-1">
                <Icon className="h-3 w-3" /> {src}: {count}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Need tabs */}
      {briefing && briefing.items.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
          <Button
            variant={activeNeedId === null ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs shrink-0 gap-1.5"
            onClick={() => { setActiveNeedId(null); setActiveFilter("all"); }}
          >
            {isZh ? "全部" : "All"}
            <Badge variant="secondary" className="h-4 min-w-[1.25rem] px-1 text-[10px] leading-none">
              {briefing.items.length}
            </Badge>
          </Button>
          {needs.filter((n) => n.enabled && needCounts.has(n.id)).map((need) => (
            <Button
              key={need.id}
              variant={activeNeedId === need.id ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs shrink-0 gap-1.5"
              onClick={() => { setActiveNeedId(need.id); setActiveFilter("all"); }}
            >
              {need.name}
              <Badge variant="secondary" className="h-4 min-w-[1.25rem] px-1 text-[10px] leading-none">
                {needCounts.get(need.id) ?? 0}
              </Badge>
            </Button>
          ))}
        </div>
      )}

      {/* Source filters (only shown on "All" tab) */}
      {activeNeedId === null && sourceTypes.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button variant={activeFilter === "all" ? "default" : "outline"} size="sm" className="h-7 text-xs" onClick={() => setActiveFilter("all")}>
            {isZh ? "全部来源" : "All Sources"}
          </Button>
          {sourceTypes.map((src) => {
            const Icon = SOURCE_ICONS[src] ?? FileText;
            return (
              <Button key={src} variant={activeFilter === src ? "default" : "outline"} size="sm" className="h-7 text-xs gap-1" onClick={() => setActiveFilter(src)}>
                <Icon className="h-3 w-3" /> {src}
              </Button>
            );
          })}
        </div>
      )}

      {/* Search bar + view toggle */}
      {briefing && briefing.items.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isZh ? "搜索标题、摘要、标签..." : "Search title, abstract, tags..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {searchQuery && (
            <span className="text-xs text-muted-foreground">
              {filteredItems.length} {isZh ? "条结果" : "results"}
            </span>
          )}
          <div className="flex-1" />
          {/* View toggle */}
          <div className="flex items-center rounded-md border bg-muted/50 p-0.5">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setViewMode("list")}
              title={isZh ? "列表视图" : "List view"}
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setViewMode("grid")}
              title={isZh ? "网格视图" : "Grid view"}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* AI Summary (global or per-need) */}
      {activeSummary && (
        <div className="rounded-lg border bg-gradient-to-br from-primary/5 to-primary/10 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">
                {activeNeedId === null
                  ? (isZh ? "AI 简报摘要" : "AI Briefing Summary")
                  : (isZh ? `AI 摘要 — ${needs.find((n) => n.id === activeNeedId)?.name ?? ""}` : `AI Summary — ${needs.find((n) => n.id === activeNeedId)?.name ?? ""}`)}
              </h3>
            </div>
            {activeNeedId === null && briefing?.summaryGeneratedAt && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(briefing.summaryGeneratedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
            {activeSummary.split("\n").map((line, i) => (
              <p
                key={i}
                className={
                  line.startsWith("- ") || line.startsWith("* ")
                    ? "ml-4"
                    : ""
                }
              >
                {line.startsWith("# ") ? (
                  <strong>{line.slice(2)}</strong>
                ) : line.startsWith("## ") ? (
                  <strong className="text-xs uppercase tracking-wider text-muted-foreground">
                    {line.slice(3)}
                  </strong>
                ) : (
                  line
                )}
              </p>
            ))}
          </div>
        </div>
      )}
      {activeNeedId !== null && !activeSummary && briefing && needFilteredItems.length > 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {isZh
            ? `"${needs.find((n) => n.id === activeNeedId)?.name ?? ""}" 暂无 AI 摘要（需要 3 条以上内容）`
            : `No AI summary for "${needs.find((n) => n.id === activeNeedId)?.name ?? ""}" yet (needs 3+ items)`}
        </div>
      )}

      {/* Content */}
      {!briefing || briefing.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox className="h-16 w-16 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">
            {needs.length === 0 ? (isZh ? "还没有信息需求" : "No information needs yet") : (isZh ? "今天还没有内容" : "No content for today")}
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            {needs.length === 0 ? (isZh ? "点击「新需求」告诉 AI 你关心什么" : "Click 'New Need' to tell AI what you care about") : (isZh ? "点击刷新获取最新内容" : "Click Refresh to fetch latest content")}
          </p>
          {needs.length === 0 ? (
            <Button className="mt-4" onClick={() => setCreatorOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> {isZh ? "添加第一个需求" : "Add your first need"}
            </Button>
          ) : (
            <Button className="mt-4" onClick={handleFetch} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              {t("refresh")}
            </Button>
          )}
        </div>
      ) : isGroupedView ? (
        /* Grouped view: cards grouped by source type */
        <div className="space-y-6">
          {[...groupedItems.entries()].map(([srcType, items]) => (
            <BriefingGroup
              key={srcType}
              sourceType={srcType}
              items={items}
              viewMode={viewMode}
              isZh={isZh}
              needsMap={needsMap}
              onFeedback={handleFeedback}
              onMarkRead={handleMarkRead}
            />
          ))}
        </div>
      ) : (
        /* Flat view with pagination */
        <>
          <div className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 gap-3"
              : "space-y-2"
          }>
            {paginatedItems.map((item) => (
              <BriefingCard key={item.id} item={item} needName={needsMap.get(item.needId)} isZh={isZh} viewMode={viewMode} onFeedback={handleFeedback} onMarkRead={handleMarkRead} />
            ))}
          </div>

          {/* Pagination */}
          {filteredItems.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-xs text-muted-foreground">
                {isZh
                  ? `显示 ${(currentPage - 1) * ITEMS_PER_PAGE + 1}-${Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length)} / ${filteredItems.length} 条`
                  : `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1}-${Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length)} of ${filteredItems.length} items`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-3 w-3 mr-0.5" />
                  {isZh ? "上一页" : "Prev"}
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((page) => {
                    // Show first, last, and pages near current
                    if (page === 1 || page === totalPages) return true;
                    return Math.abs(page - currentPage) <= 1;
                  })
                  .reduce<(number | "ellipsis")[]>((acc, page, idx, arr) => {
                    if (idx > 0) {
                      const prev = arr[idx - 1];
                      if (page - prev > 1) acc.push("ellipsis");
                    }
                    acc.push(page);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    item === "ellipsis" ? (
                      <span key={`e-${idx}`} className="px-1 text-xs text-muted-foreground">...</span>
                    ) : (
                      <Button
                        key={item}
                        variant={currentPage === item ? "default" : "outline"}
                        size="sm"
                        className="h-7 w-7 p-0 text-xs"
                        onClick={() => setCurrentPage(item)}
                      >
                        {item}
                      </Button>
                    )
                  )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  {isZh ? "下一页" : "Next"}
                  <ChevronRight className="h-3 w-3 ml-0.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Needs manager drawer */}
      <NeedsManager open={settingsOpen} onClose={() => setSettingsOpen(false)} needs={needs} onNeedsChange={loadNeeds} isZh={isZh} />

      {/* Need creator dialog */}
      <NeedCreatorDialog open={creatorOpen} onClose={() => setCreatorOpen(false)} onCreated={() => { loadNeeds(); setCreatorOpen(false); }} isZh={isZh} />

      {/* Config settings drawer */}
      <BriefingSettings open={configOpen} onClose={() => setConfigOpen(false)} isZh={isZh} />
    </div>
  );
}
