"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Plus,
  Trash2,
  Save,
  Github,
  BookOpen,
  FileText,
  Rss,
  Search,
  Settings2,
  Play,
  TrendingUp,
  Globe,
  Plug,
  Send,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/toast";
import type { SourceType, PushConfig, PushChannel } from "../types";

interface RssFeed { name: string; url: string }

interface BriefingConfig {
  sources: Record<SourceType, boolean>;
  github: { language: string; timeRange: string };
  arxiv: { categories: string[] };
  rssFeeds: RssFeed[];
  display: { maxItemsPerSource: number; autoRefreshInterval: string };
  summaryLanguage: "zh" | "en";
}

const DEFAULT_CONFIG: BriefingConfig = {
  sources: { github: true, huggingface: true, arxiv: true, rss: false, rsshub: false, youtube: false, finance: false, "web-search": true, "custom-api": false },
  github: { language: "All", timeRange: "daily" },
  arxiv: { categories: ["cs.AI", "cs.CL", "cs.CV", "cs.LG"] },
  rssFeeds: [],
  display: { maxItemsPerSource: 10, autoRefreshInterval: "off" },
  summaryLanguage: "en",
};

const SOURCE_META: { type: SourceType; icon: typeof Github; label: string; labelZh: string }[] = [
  { type: "github", icon: Github, label: "GitHub", labelZh: "GitHub" },
  { type: "huggingface", icon: BookOpen, label: "HuggingFace", labelZh: "HuggingFace" },
  { type: "arxiv", icon: FileText, label: "arXiv", labelZh: "arXiv" },
  { type: "rss", icon: Rss, label: "RSS Feeds", labelZh: "RSS 订阅" },
  { type: "rsshub", icon: Globe, label: "RSSHub", labelZh: "RSSHub 订阅" },
  { type: "youtube", icon: Play, label: "YouTube", labelZh: "YouTube" },
  { type: "finance", icon: TrendingUp, label: "Finance", labelZh: "财经新闻" },
  { type: "web-search", icon: Search, label: "Web Search", labelZh: "网页搜索" },
  { type: "custom-api", icon: Plug, label: "Custom API", labelZh: "自定义 API" },
];

interface ConfigPreset {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  icon: string;
  config: Partial<BriefingConfig>;
}

const CONFIG_PRESETS: ConfigPreset[] = [
  {
    id: "ml-researcher",
    name: "ML Researcher",
    nameZh: "ML 研究者",
    description: "arXiv + HuggingFace + GitHub ML repos",
    descriptionZh: "arXiv + HuggingFace + GitHub ML 仓库",
    icon: "\u{1F52C}",
    config: {
      sources: { github: true, huggingface: true, arxiv: true, rss: false, rsshub: false, youtube: false, finance: false, "web-search": false, "custom-api": false },
      github: { language: "Python", timeRange: "weekly" },
      arxiv: { categories: ["cs.AI", "cs.CL", "cs.CV", "cs.LG", "cs.NE"] },
      display: { maxItemsPerSource: 15, autoRefreshInterval: "2h" },
    },
  },
  {
    id: "fullstack-dev",
    name: "Full Stack Dev",
    nameZh: "全栈开发者",
    description: "GitHub trending + RSS tech blogs",
    descriptionZh: "GitHub 趋势 + RSS 技术博客",
    icon: "\u{1F4BB}",
    config: {
      sources: { github: true, huggingface: false, arxiv: false, rss: true, rsshub: false, youtube: false, finance: false, "web-search": true, "custom-api": false },
      github: { language: "TypeScript", timeRange: "daily" },
      arxiv: { categories: [] },
      rssFeeds: [
        { name: "Hacker News", url: "https://hnrss.org/frontpage" },
        { name: "Dev.to", url: "https://dev.to/feed" },
      ],
      display: { maxItemsPerSource: 10, autoRefreshInterval: "1h" },
    },
  },
  {
    id: "ai-engineer",
    name: "AI Engineer",
    nameZh: "AI 工程师",
    description: "All AI sources, balanced",
    descriptionZh: "全部 AI 来源，均衡配置",
    icon: "\u{1F916}",
    config: {
      sources: { github: true, huggingface: true, arxiv: true, rss: true, rsshub: false, youtube: false, finance: false, "web-search": true, "custom-api": false },
      github: { language: "Python", timeRange: "daily" },
      arxiv: { categories: ["cs.AI", "cs.CL", "cs.LG"] },
      rssFeeds: [
        { name: "OpenAI Blog", url: "https://openai.com/blog/rss.xml" },
      ],
      display: { maxItemsPerSource: 10, autoRefreshInterval: "2h" },
    },
  },
  {
    id: "robotics",
    name: "Robotics",
    nameZh: "机器人",
    description: "Robotics papers + hardware repos",
    descriptionZh: "机器人论文 + 硬件仓库",
    icon: "\u{1F9BE}",
    config: {
      sources: { github: true, huggingface: true, arxiv: true, rss: false, rsshub: false, youtube: false, finance: false, "web-search": false, "custom-api": false },
      github: { language: "Python", timeRange: "weekly" },
      arxiv: { categories: ["cs.RO", "cs.AI", "cs.CV"] },
      display: { maxItemsPerSource: 15, autoRefreshInterval: "6h" },
    },
  },
  {
    id: "minimal",
    name: "Minimal",
    nameZh: "精简模式",
    description: "HuggingFace daily papers only",
    descriptionZh: "仅 HuggingFace 每日论文",
    icon: "\u2728",
    config: {
      sources: { github: false, huggingface: true, arxiv: false, rss: false, rsshub: false, youtube: false, finance: false, "web-search": false, "custom-api": false },
      display: { maxItemsPerSource: 20, autoRefreshInterval: "off" },
    },
  },
];

const GITHUB_LANGUAGES = ["All", "Python", "TypeScript", "JavaScript", "Rust", "Go", "Java", "C++", "C", "Swift", "Kotlin", "Ruby", "PHP"];
const ARXIV_CATEGORIES = ["cs.AI", "cs.CL", "cs.CV", "cs.LG", "cs.NE", "cs.IR", "cs.RO", "cs.SE", "cs.DC", "stat.ML", "eess.IV"];

const TIME_RANGES: { value: string; label: string; labelZh: string }[] = [
  { value: "daily", label: "Daily", labelZh: "每日" }, { value: "weekly", label: "Weekly", labelZh: "每周" }, { value: "monthly", label: "Monthly", labelZh: "每月" },
];
const REFRESH_INTERVALS: { value: string; label: string; labelZh: string }[] = [
  { value: "off", label: "Off", labelZh: "关闭" }, { value: "30min", label: "30 min", labelZh: "30 分钟" },
  { value: "1h", label: "1 hour", labelZh: "1 小时" }, { value: "2h", label: "2 hours", labelZh: "2 小时" }, { value: "6h", label: "6 hours", labelZh: "6 小时" },
];

interface BriefingSettingsProps { open: boolean; onClose: () => void; isZh: boolean }

export function BriefingSettings({ open, onClose, isZh }: BriefingSettingsProps) {
  const [config, setConfig] = useState<BriefingConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newFeed, setNewFeed] = useState<RssFeed>({ name: "", url: "" });
  const { toast } = useToast();

  // Push config state
  const DEFAULT_PUSH_CONFIG: PushConfig = {
    enabled: false,
    channels: [],
    format: "summary-and-items",
    maxItems: 10,
    includeLinks: true,
  };
  const [pushConfig, setPushConfig] = useState<PushConfig>(DEFAULT_PUSH_CONFIG);
  const [pushDirty, setPushDirty] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);
  const [newChannel, setNewChannel] = useState<{ platform: "telegram" | "feishu"; chatId: string }>({ platform: "telegram", chatId: "" });

  // Load config on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch("/api/plugins/daily-briefing/config");
        if (res.ok) {
          const { config: saved } = await res.json();
          if (saved) {
            setConfig({ ...DEFAULT_CONFIG, ...saved });
          }
        }
      } catch {
        /* use defaults */
      }
      // Load push config
      try {
        const res = await fetch("/api/plugins/daily-briefing/push");
        if (res.ok) {
          const { config: saved } = await res.json();
          if (saved) {
            setPushConfig({ ...DEFAULT_PUSH_CONFIG, ...saved });
          }
        }
      } catch {
        /* use defaults */
      }
      setDirty(false);
      setPushDirty(false);
    })();
  }, [open]);

  const update = useCallback(<K extends keyof BriefingConfig>(
    key: K,
    value: BriefingConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const toggleSource = useCallback((type: SourceType) => {
    setConfig((prev) => ({
      ...prev,
      sources: { ...prev.sources, [type]: !prev.sources[type] },
    }));
    setDirty(true);
  }, []);

  const toggleArxivCategory = useCallback((cat: string) => {
    setConfig((prev) => {
      const cats = prev.arxiv.categories;
      const next = cats.includes(cat)
        ? cats.filter((c) => c !== cat)
        : [...cats, cat];
      return { ...prev, arxiv: { ...prev.arxiv, categories: next } };
    });
    setDirty(true);
  }, []);

  const addRssFeed = useCallback(() => {
    if (!newFeed.name.trim() || !newFeed.url.trim()) return;
    setConfig((prev) => ({
      ...prev,
      rssFeeds: [...prev.rssFeeds, { name: newFeed.name.trim(), url: newFeed.url.trim() }],
    }));
    setNewFeed({ name: "", url: "" });
    setDirty(true);
  }, [newFeed]);

  const removeRssFeed = useCallback((index: number) => {
    setConfig((prev) => ({
      ...prev,
      rssFeeds: prev.rssFeeds.filter((_, i) => i !== index),
    }));
    setDirty(true);
  }, []);

  const applyPreset = useCallback((preset: ConfigPreset) => {
    setConfig((prev) => ({
      ...prev,
      ...preset.config,
      sources: { ...prev.sources, ...preset.config.sources },
      github: { ...prev.github, ...preset.config.github },
      arxiv: { ...prev.arxiv, ...preset.config.arxiv },
      display: { ...prev.display, ...preset.config.display },
      rssFeeds: preset.config.rssFeeds ?? prev.rssFeeds,
    }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/plugins/daily-briefing/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setDirty(false);
    } catch (err) {
      console.error("[BriefingSettings] Save error:", err);
    }
    setSaving(false);
  }, [config]);

  // Push config helpers
  const updatePush = useCallback(<K extends keyof PushConfig>(key: K, value: PushConfig[K]) => {
    setPushConfig((prev) => ({ ...prev, [key]: value }));
    setPushDirty(true);
  }, []);

  const addPushChannel = useCallback(() => {
    if (!newChannel.chatId.trim()) return;
    const channel: PushChannel = {
      platform: newChannel.platform,
      chatId: newChannel.chatId.trim(),
      enabled: true,
    };
    setPushConfig((prev) => ({
      ...prev,
      channels: [...prev.channels, channel],
    }));
    setNewChannel({ platform: "telegram", chatId: "" });
    setPushDirty(true);
  }, [newChannel]);

  const removePushChannel = useCallback((index: number) => {
    setPushConfig((prev) => ({
      ...prev,
      channels: prev.channels.filter((_, i) => i !== index),
    }));
    setPushDirty(true);
  }, []);

  const togglePushChannel = useCallback((index: number) => {
    setPushConfig((prev) => ({
      ...prev,
      channels: prev.channels.map((ch, i) =>
        i === index ? { ...ch, enabled: !ch.enabled } : ch,
      ),
    }));
    setPushDirty(true);
  }, []);

  const handleSavePush = useCallback(async () => {
    setPushSaving(true);
    try {
      await fetch("/api/plugins/daily-briefing/push", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pushConfig),
      });
      setPushDirty(false);
      toast(isZh ? "推送设置已保存" : "Push settings saved", "success");
    } catch (err) {
      console.error("[BriefingSettings] Save push config error:", err);
      toast(isZh ? "保存推送设置失败" : "Failed to save push settings", "error");
    }
    setPushSaving(false);
  }, [pushConfig, isZh, toast]);

  const handleTestPush = useCallback(async () => {
    setPushTesting(true);
    try {
      const res = await fetch("/api/plugins/daily-briefing/push", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || (isZh ? "测试推送失败" : "Test push failed"), "error");
      } else {
        toast(
          isZh
            ? `测试推送完成（${data.successCount} 成功，${data.failCount} 失败）`
            : `Test push done (${data.successCount} ok, ${data.failCount} failed)`,
          data.failCount > 0 ? "info" : "success",
        );
      }
    } catch {
      toast(isZh ? "测试推送失败" : "Test push failed", "error");
    }
    setPushTesting(false);
  }, [isZh, toast]);

  if (!open) return null;

  const t = (en: string, zh: string) => (isZh ? zh : en);

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg z-50 bg-background border-l shadow-xl overflow-y-auto animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-background z-10">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {t("Briefing Settings", "简报设置")}
          </h2>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* ---- Quick Setup Presets ---- */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("Quick Setup", "快速配置")}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {CONFIG_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="rounded-lg border p-3 text-left hover:border-primary/50 hover:bg-accent/30 transition-all"
                  onClick={() => applyPreset(preset)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{preset.icon}</span>
                    <span className="text-sm font-medium">{isZh ? preset.nameZh : preset.name}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                    {isZh ? preset.descriptionZh : preset.description}
                  </p>
                </button>
              ))}
            </div>
          </section>

          {/* ---- Data Sources ---- */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("Data Sources", "数据源")}
            </h3>
            <div className="space-y-2">
              {SOURCE_META.map(({ type, icon: Icon, label, labelZh }) => (
                <div key={type} className="flex items-center justify-between rounded-md border px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{isZh ? labelZh : label}</span>
                  </div>
                  <Switch
                    checked={config.sources[type]}
                    onCheckedChange={() => toggleSource(type)}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* ---- GitHub Settings ---- */}
          {config.sources.github && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {t("GitHub Settings", "GitHub 设置")}
              </h3>
              <div className="space-y-3 rounded-md border p-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    {t("Language Filter", "语言筛选")}
                  </label>
                  <Select
                    value={config.github.language}
                    onValueChange={(v) => update("github", { ...config.github, language: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GITHUB_LANGUAGES.map((lang) => (
                        <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    {t("Time Range", "时间范围")}
                  </label>
                  <Select
                    value={config.github.timeRange}
                    onValueChange={(v) => update("github", { ...config.github, timeRange: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_RANGES.map(({ value, label: en, labelZh: zh }) => (
                        <SelectItem key={value} value={value}>{isZh ? zh : en}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>
          )}

          {/* ---- arXiv Settings ---- */}
          {config.sources.arxiv && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {t("arXiv Settings", "arXiv 设置")}
              </h3>
              <div className="rounded-md border p-4">
                <label className="text-xs text-muted-foreground mb-2 block">
                  {t("Search Categories", "搜索分类")}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ARXIV_CATEGORIES.map((cat) => {
                    const active = config.arxiv.categories.includes(cat);
                    return (
                      <Badge
                        key={cat}
                        variant={active ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        onClick={() => toggleArxivCategory(cat)}
                      >
                        {cat}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* ---- RSS Feeds ---- */}
          {config.sources.rss && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {t("RSS Feeds", "RSS 订阅")}
              </h3>
              <div className="rounded-md border p-4 space-y-3">
                {/* Existing feeds */}
                {config.rssFeeds.length > 0 ? (
                  <div className="space-y-2">
                    {config.rssFeeds.map((feed, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Rss className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate min-w-0">{feed.name}</span>
                        <span className="text-muted-foreground truncate min-w-0 flex-1">{feed.url}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRssFeed(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("No feeds added yet.", "还没有添加订阅源。")}
                  </p>
                )}

                {/* Add new feed */}
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-xs flex-1"
                    placeholder={t("Feed name", "名称")}
                    value={newFeed.name}
                    onChange={(e) => setNewFeed((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <Input
                    className="h-8 text-xs flex-[2]"
                    placeholder={t("Feed URL", "订阅链接")}
                    value={newFeed.url}
                    onChange={(e) => setNewFeed((prev) => ({ ...prev, url: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") addRssFeed(); }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={addRssFeed}
                    disabled={!newFeed.name.trim() || !newFeed.url.trim()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* ---- Push Notifications ---- */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("Push Notifications", "推送通知")}
            </h3>
            <div className="space-y-3 rounded-md border p-4">
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{t("Enable Push", "启用推送")}</span>
                </div>
                <Switch
                  checked={pushConfig.enabled}
                  onCheckedChange={(v) => updatePush("enabled", v)}
                />
              </div>

              {/* Channels */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  {t("Channels", "推送渠道")}
                </label>
                {pushConfig.channels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("No channels configured.", "暂无推送渠道。")}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {pushConfig.channels.map((ch, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <Badge variant="outline" className="text-[10px]">{ch.platform}</Badge>
                        <span className="text-muted-foreground truncate flex-1 text-xs">{ch.chatId}</span>
                        <Switch
                          checked={ch.enabled}
                          onCheckedChange={() => togglePushChannel(i)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removePushChannel(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add channel */}
                <div className="flex gap-2 items-center">
                  <Select
                    value={newChannel.platform}
                    onValueChange={(v) => setNewChannel((prev) => ({ ...prev, platform: v as "telegram" | "feishu" }))}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="telegram">Telegram</SelectItem>
                      <SelectItem value="feishu">{isZh ? "飞书" : "Feishu"}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-8 text-xs flex-1"
                    placeholder="Chat ID"
                    value={newChannel.chatId}
                    onChange={(e) => setNewChannel((prev) => ({ ...prev, chatId: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") addPushChannel(); }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    onClick={addPushChannel}
                    disabled={!newChannel.chatId.trim()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Format */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  {t("Format", "推送格式")}
                </label>
                <Select
                  value={pushConfig.format}
                  onValueChange={(v) => updatePush("format", v as PushConfig["format"])}
                >
                  <SelectTrigger className="h-9 w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="summary-only">{t("Summary only", "仅摘要")}</SelectItem>
                    <SelectItem value="summary-and-items">{t("Summary + Items", "摘要 + 条目")}</SelectItem>
                    <SelectItem value="items-only">{t("Items only", "仅条目")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Max items */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  {t("Max items", "最大条目数")}
                </label>
                <Input
                  type="number"
                  className="h-9 w-24"
                  min={1}
                  max={20}
                  value={pushConfig.maxItems}
                  onChange={(e) =>
                    updatePush("maxItems", Math.max(1, Math.min(20, Number(e.target.value) || 10)))
                  }
                />
              </div>

              {/* Include links */}
              <div className="flex items-center justify-between">
                <span className="text-sm">{t("Include links", "包含链接")}</span>
                <Switch
                  checked={pushConfig.includeLinks}
                  onCheckedChange={(v) => updatePush("includeLinks", v)}
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleSavePush}
                  disabled={pushSaving || !pushDirty}
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {pushSaving
                    ? t("Saving...", "保存中...")
                    : pushDirty
                      ? t("Save Push Settings", "保存推送设置")
                      : t("Saved", "已保存")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestPush}
                  disabled={pushTesting || pushConfig.channels.filter((c) => c.enabled).length === 0}
                >
                  {pushTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  {t("Test Push", "测试推送")}
                </Button>
              </div>
            </div>
          </section>

          {/* ---- Display Settings ---- */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("Display", "显示")}
            </h3>
            <div className="space-y-3 rounded-md border p-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  {t("Summary Language", "简报语言")}
                </label>
                <Select
                  value={config.summaryLanguage ?? "en"}
                  onValueChange={(v) =>
                    update("summaryLanguage", v as "zh" | "en")
                  }
                >
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh">中文</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  {t("Max items per source", "每个来源最大条目数")}
                </label>
                <Input
                  type="number"
                  className="h-9 w-24"
                  min={1}
                  max={100}
                  value={config.display.maxItemsPerSource}
                  onChange={(e) =>
                    update("display", {
                      ...config.display,
                      maxItemsPerSource: Math.max(1, Math.min(100, Number(e.target.value) || 10)),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  {t("Auto-refresh interval", "自动刷新间隔")}
                </label>
                <Select
                  value={config.display.autoRefreshInterval}
                  onValueChange={(v) =>
                    update("display", { ...config.display, autoRefreshInterval: v })
                  }
                >
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REFRESH_INTERVALS.map(({ value, label: en, labelZh: zh }) => (
                      <SelectItem key={value} value={value}>{isZh ? zh : en}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>
        </div>

        {/* Sticky save footer */}
        <div className="sticky bottom-0 border-t bg-background px-6 py-4">
          <Button className="w-full" onClick={handleSave} disabled={saving || !dirty}>
            <Save className="h-4 w-4 mr-2" />
            {saving
              ? t("Saving...", "保存中...")
              : dirty
                ? t("Save Settings", "保存设置")
                : t("Saved", "已保存")}
          </Button>
        </div>
      </div>
    </>
  );
}
