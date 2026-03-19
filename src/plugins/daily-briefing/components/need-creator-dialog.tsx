"use client";

import { useState, useCallback } from "react";
import {
  Loader2,
  Sparkles,
  Save,
  Play,
  Plus,
  Trash2,
  Github,
  BookOpen,
  Rss,
  FileText,
  Search,
  Youtube,
  TrendingUp,
  Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { SearchStrategy, SourceConfig, SourceType } from "../types";

/** Available source types with their display metadata */
const SOURCE_TYPE_OPTIONS: {
  type: SourceType;
  label: string;
  labelZh: string;
  icon: typeof Github;
}[] = [
  { type: "github", label: "GitHub", labelZh: "GitHub", icon: Github },
  { type: "huggingface", label: "HuggingFace", labelZh: "HuggingFace", icon: BookOpen },
  { type: "arxiv", label: "arXiv", labelZh: "arXiv", icon: FileText },
  { type: "rss", label: "RSS", labelZh: "RSS", icon: Rss },
  { type: "rsshub", label: "RSSHub", labelZh: "RSSHub", icon: Rss },
  { type: "youtube", label: "YouTube", labelZh: "YouTube", icon: Youtube },
  { type: "finance", label: "Finance", labelZh: "财经", icon: TrendingUp },
  { type: "web-search", label: "Web Search", labelZh: "网页搜索", icon: Search },
  { type: "custom-api", label: "Custom API", labelZh: "自定义API", icon: Plug },
];

/** Config field definitions per source type */
const SOURCE_CONFIG_FIELDS: Record<
  string,
  { key: string; label: string; labelZh: string; placeholder: string; optional?: boolean }[]
> = {
  rsshub: [
    { key: "route", label: "Route", labelZh: "路由", placeholder: "/bilibili/hot/0/3" },
    { key: "baseUrl", label: "Base URL", labelZh: "Base URL", placeholder: "https://rsshub.app", optional: true },
  ],
  youtube: [
    { key: "channelId", label: "Channel ID or Playlist ID", labelZh: "频道ID 或 播放列表ID", placeholder: "UCxxxxxx or PLxxxxxx" },
  ],
  finance: [
    { key: "symbols", label: "Stock Symbols", labelZh: "股票代码", placeholder: "AAPL,TSLA,NVDA" },
    { key: "apiToken", label: "Finnhub API Token", labelZh: "Finnhub API Token", placeholder: "Your Finnhub token", optional: true },
  ],
  "custom-api": [
    { key: "url", label: "URL", labelZh: "URL", placeholder: "https://api.example.com/feed" },
    { key: "itemsPath", label: "Items Path", labelZh: "数据路径", placeholder: "data.items" },
    { key: "fieldMapping", label: "Field Mapping (JSON)", labelZh: "字段映射 (JSON)", placeholder: '{"title":"name","url":"link"}', optional: true },
  ],
};

interface NeedCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  isZh: boolean;
}

export function NeedCreatorDialog({
  open,
  onClose,
  onCreated,
  isZh,
}: NeedCreatorDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [strategy, setStrategy] = useState<SearchStrategy | null>(null);
  const [generating, setGenerating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setTagsInput("");
    setStrategy(null);
    setTestResults(null);
    setSaving(false);
  }, []);

  const handleGenerateStrategy = useCallback(async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setStrategy(null);

    try {
      const res = await fetch("/api/plugins/daily-briefing/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });

      if (!res.ok) throw new Error("Strategy generation failed");
      const data = await res.json();
      setStrategy(data.strategy);

      // Auto-fill name if empty
      if (!name.trim() && data.strategy?.keywords?.length > 0) {
        setName(data.strategy.keywords.slice(0, 3).join(" + "));
      }
    } catch (err) {
      console.error("[NeedCreator] Strategy error:", err);
    }
    setGenerating(false);
  }, [description, name]);

  const handleTestSearch = useCallback(async () => {
    if (!strategy) return;
    setTesting(true);
    setTestResults(null);

    try {
      const res = await fetch("/api/plugins/daily-briefing/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, strategy }),
      });

      if (!res.ok) throw new Error("Test search failed");
      const data = await res.json();
      setTestResults(data.count ?? 0);
    } catch (err) {
      console.error("[NeedCreator] Test error:", err);
    }
    setTesting(false);
  }, [strategy]);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !strategy) return;
    setSaving(true);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/plugins/daily-briefing/needs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          tags,
          strategy,
          enabled: true,
        }),
      });

      if (!res.ok) throw new Error("Save failed");

      resetForm();
      onCreated();
    } catch (err) {
      console.error("[NeedCreator] Save error:", err);
      setSaving(false);
    }
  }, [name, description, tagsInput, strategy, onCreated, resetForm]);

  const handleAddSource = useCallback(() => {
    if (!strategy) return;
    const newSource: SourceConfig = {
      type: "rss",
      name: "New Source",
      config: {},
      priority: 3,
    };
    setStrategy({
      ...strategy,
      sources: [...strategy.sources, newSource],
    });
  }, [strategy]);

  const handleRemoveSource = useCallback(
    (idx: number) => {
      if (!strategy) return;
      setStrategy({
        ...strategy,
        sources: strategy.sources.filter((_, i) => i !== idx),
      });
    },
    [strategy],
  );

  const handleUpdateSourceType = useCallback(
    (idx: number, newType: SourceType) => {
      if (!strategy) return;
      const option = SOURCE_TYPE_OPTIONS.find((o) => o.type === newType);
      const updated = strategy.sources.map((src, i) =>
        i === idx
          ? { ...src, type: newType, name: option?.label ?? newType, config: {} }
          : src,
      );
      setStrategy({ ...strategy, sources: updated });
    },
    [strategy],
  );

  const handleUpdateSourceConfig = useCallback(
    (idx: number, key: string, value: string) => {
      if (!strategy) return;
      const updated = strategy.sources.map((src, i) =>
        i === idx
          ? { ...src, config: { ...src.config, [key]: value } }
          : src,
      );
      setStrategy({ ...strategy, sources: updated });
    },
    [strategy],
  );

  const handleUpdateKeywords = useCallback(
    (value: string) => {
      if (!strategy) return;
      setStrategy({
        ...strategy,
        keywords: value
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      });
    },
    [strategy],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isZh ? "创建新的信息需求" : "Create Information Need"}
          </DialogTitle>
          <DialogDescription>
            {isZh
              ? "描述你关心的信息领域，AI 会帮你制定搜索策略"
              : "Describe what you want to track and AI will create a search strategy"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Name */}
          <div>
            <label className="text-sm font-medium">
              {isZh ? "名称" : "Name"}
            </label>
            <Input
              className="mt-1"
              placeholder={
                isZh ? "例如：LLM Agent 框架" : "e.g. LLM Agent Frameworks"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium">
              {isZh ? "描述你关心的内容" : "Describe what you care about"}
            </label>
            <Textarea
              className="mt-1 min-h-[80px]"
              placeholder={
                isZh
                  ? "例如：我想跟踪 vision-language model 的最新论文和开源实现"
                  : "e.g. I want to track the latest VLM papers and open-source implementations"
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Generate Strategy button */}
          <Button
            onClick={handleGenerateStrategy}
            disabled={!description.trim() || generating}
            className="w-full"
            variant="outline"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            {isZh ? "生成搜索策略" : "Generate Strategy"}
          </Button>

          {/* Strategy display */}
          {strategy && (
            <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
              <h4 className="text-sm font-semibold">
                {isZh ? "搜索策略" : "Search Strategy"}
              </h4>

              {/* Keywords */}
              <div>
                <label className="text-xs text-muted-foreground">
                  {isZh ? "关键词" : "Keywords"}
                </label>
                <Input
                  className="mt-1 h-8 text-xs"
                  value={strategy.keywords.join(", ")}
                  onChange={(e) => handleUpdateKeywords(e.target.value)}
                />
              </div>

              {/* Sources */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">
                    {isZh ? "数据源" : "Sources"}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleAddSource}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {isZh ? "添加" : "Add"}
                  </Button>
                </div>
                <div className="space-y-2 mt-1">
                  {strategy.sources.map((src, idx) => {
                    const configFields = SOURCE_CONFIG_FIELDS[src.type];
                    return (
                      <div
                        key={idx}
                        className="rounded border p-2 space-y-1.5"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <select
                            className="h-6 rounded border bg-background px-1 text-[11px]"
                            value={src.type}
                            onChange={(e) =>
                              handleUpdateSourceType(idx, e.target.value as SourceType)
                            }
                          >
                            {SOURCE_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.type} value={opt.type}>
                                {isZh ? opt.labelZh : opt.label}
                              </option>
                            ))}
                          </select>
                          <span className="flex-1 truncate text-muted-foreground">
                            {src.name}
                          </span>
                          <span className="text-muted-foreground">
                            P{src.priority}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveSource(idx)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        {configFields && configFields.length > 0 && (
                          <div className="space-y-1 pl-1">
                            {configFields.map((field) => (
                              <div key={field.key} className="flex items-center gap-1.5">
                                <label className="text-[10px] text-muted-foreground w-20 shrink-0 truncate">
                                  {isZh ? field.labelZh : field.label}
                                  {field.optional && (
                                    <span className="text-muted-foreground/50"> *</span>
                                  )}
                                </label>
                                <Input
                                  className="h-6 text-[11px] flex-1"
                                  placeholder={field.placeholder}
                                  value={src.config[field.key] ?? ""}
                                  onChange={(e) =>
                                    handleUpdateSourceConfig(idx, field.key, e.target.value)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Schedule */}
              <div>
                <label className="text-xs text-muted-foreground">
                  {isZh ? "频率" : "Schedule"}
                </label>
                <div className="flex gap-2 mt-1">
                  {(["manual", "daily", "weekly"] as const).map((s) => (
                    <Badge
                      key={s}
                      variant={
                        strategy.schedule === s ? "default" : "outline"
                      }
                      className="cursor-pointer text-[10px]"
                      onClick={() =>
                        setStrategy({ ...strategy, schedule: s })
                      }
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Test search */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestSearch}
                  disabled={testing}
                  className="text-xs"
                >
                  {testing ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Play className="h-3 w-3 mr-1" />
                  )}
                  {isZh ? "试搜一下" : "Test Search"}
                </Button>
                {testResults !== null && (
                  <span className="text-xs text-muted-foreground">
                    {isZh
                      ? `找到 ${testResults} 条结果`
                      : `Found ${testResults} results`}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="text-sm font-medium">
              {isZh ? "标签（逗号分隔）" : "Tags (comma-separated)"}
            </label>
            <Input
              className="mt-1"
              placeholder={isZh ? "例如：AI, 论文, 开源" : "e.g. AI, papers, open-source"}
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                onClose();
              }}
            >
              {isZh ? "取消" : "Cancel"}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || !strategy || saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              {isZh ? "保存" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
