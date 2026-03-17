"use client";

import { useState, useEffect, useCallback, type DragEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  GripVertical,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  FolderOpen,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Folder,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  SkipForward,
  PauseCircle,
  Clock,
} from "lucide-react";
import { SKILLS_BY_CATEGORY, CATEGORY_META, ARIS_SKILLS } from "../skill-data";
import type { SkillCategory, ArisSkill } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeftPanelProps {
  locale: string;
  workspacePath: string | null;
  nodes: Array<{
    id: string;
    skillId: string;
    status: string;
    paramValues: Record<string, string>;
  }>;
  onNodeClick: (nodeId: string) => void;
  /** Whether panel is collapsed to icon-only mode */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

type TabId = "skills" | "files" | "overview";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES: SkillCategory[] = [
  "workflow",
  "research",
  "experiment",
  "paper",
  "utility",
];

const TAB_META: Record<TabId, { label: string; labelZh: string; Icon: typeof LayoutGrid }> = {
  skills: { label: "Skills", labelZh: "技能", Icon: LayoutGrid },
  files: { label: "Files", labelZh: "文件", Icon: FolderOpen },
  overview: { label: "Overview", labelZh: "概览", Icon: List },
};

const TAB_ORDER: TabId[] = ["skills", "files", "overview"];

const STATUS_ICON_MAP: Record<string, typeof Circle> = {
  idle: Circle,
  queued: Clock,
  running: Loader2,
  done: CheckCircle2,
  error: XCircle,
  skipped: SkipForward,
  checkpoint: PauseCircle,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DraggableSkillItem({
  skill,
  isZh,
}: {
  skill: ArisSkill;
  isZh: boolean;
}) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData("application/aris-skill", skill.id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing hover:bg-accent transition-colors group"
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">
          {isZh ? skill.nameZh : skill.name}
        </div>
        <code className="text-[10px] text-muted-foreground font-mono">
          {skill.command}
        </code>
      </div>
      <Badge
        variant={
          skill.tier === 3
            ? "default"
            : skill.tier === 2
              ? "secondary"
              : "outline"
        }
        className="text-[9px] px-1 py-0 shrink-0"
      >
        T{skill.tier}
      </Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills Tab
// ---------------------------------------------------------------------------

function SkillsTab({ isZh }: { isZh: boolean }) {
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>(
    {},
  );

  const toggleCategory = (cat: string) => {
    setCollapsedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            className="h-7 text-xs pl-7"
            placeholder={isZh ? "搜索技能..." : "Search skills..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Skill list */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {CATEGORIES.map((cat) => {
            const meta = CATEGORY_META[cat];
            const skills = SKILLS_BY_CATEGORY[cat].filter((s) => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                s.name.toLowerCase().includes(q) ||
                s.nameZh.includes(q) ||
                s.command.includes(q)
              );
            });

            if (skills.length === 0) return null;
            const isOpen = !collapsedCats[cat];

            return (
              <div key={cat} className="mb-1">
                <button
                  className="flex items-center gap-1 w-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => toggleCategory(cat)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {isZh ? meta.labelZh : meta.label}
                  <span className="ml-auto text-[10px]">
                    ({skills.length})
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-0.5">
                    {skills.map((skill) => (
                      <DraggableSkillItem
                        key={skill.id}
                        skill={skill}
                        isZh={isZh}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Drag hint */}
      <div className="p-2 border-t text-[10px] text-muted-foreground text-center">
        {isZh ? "拖拽技能到画布" : "Drag skills onto canvas"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files Tab
// ---------------------------------------------------------------------------

function FilesTab({
  workspacePath,
  isZh,
}: {
  workspacePath: string | null;
  isZh: boolean;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, FileEntry[]>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const res = await fetch(
        `/api/browse?path=${encodeURIComponent(dirPath)}`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: FileEntry[] = await res.json();
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      throw new Error(msg);
    }
  }, []);

  // Load root directory
  useEffect(() => {
    if (!workspacePath) {
      setEntries([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchDir(workspacePath)
      .then((data) => {
        if (!cancelled) {
          setEntries(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspacePath, fetchDir]);

  const toggleDir = useCallback(
    async (dirPath: string) => {
      if (expandedDirs[dirPath] !== undefined) {
        // Collapse: remove from expanded
        setExpandedDirs((prev) => {
          const next = { ...prev };
          delete next[dirPath];
          return next;
        });
        return;
      }

      // Expand: fetch contents
      try {
        const children = await fetchDir(dirPath);
        setExpandedDirs((prev) => ({ ...prev, [dirPath]: children }));
      } catch {
        // Silently fail; the directory may not be accessible
      }
    },
    [expandedDirs, fetchDir],
  );

  const handleFileCopy = useCallback(async (filePath: string) => {
    try {
      await navigator.clipboard.writeText(filePath);
    } catch {
      // Clipboard not available
    }
  }, []);

  if (!workspacePath) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-xs text-muted-foreground text-center">
          {isZh
            ? "运行流水线后会自动创建工作区"
            : "Workspace will be created when you run the pipeline"}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-xs text-destructive text-center">{error}</p>
      </div>
    );
  }

  const renderEntries = (items: FileEntry[], depth: number) =>
    items.map((entry) => {
      const isDir = entry.type === "directory";
      const isExpanded = expandedDirs[entry.path] !== undefined;
      const children = expandedDirs[entry.path];

      return (
        <div key={entry.path}>
          <button
            className="flex items-center gap-1.5 w-full px-2 py-1 text-xs hover:bg-accent rounded transition-colors"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() =>
              isDir ? toggleDir(entry.path) : handleFileCopy(entry.path)
            }
            title={entry.path}
          >
            {isDir ? (
              <>
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <Folder className="h-3 w-3 shrink-0 text-amber-500" />
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              </>
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {isDir && isExpanded && children && (
            <div>{renderEntries(children, depth + 1)}</div>
          )}
        </div>
      );
    });

  return (
    <ScrollArea className="h-full">
      <div className="p-1">{renderEntries(entries, 0)}</div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({
  nodes,
  onNodeClick,
  isZh,
}: {
  nodes: LeftPanelProps["nodes"];
  onNodeClick: (nodeId: string) => void;
  isZh: boolean;
}) {
  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-xs text-muted-foreground text-center">
          {isZh ? "尚无节点" : "No nodes yet"}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-1 space-y-0.5">
        {nodes.map((node) => {
          const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
          const skillName = skill
            ? isZh
              ? skill.nameZh
              : skill.name
            : node.skillId;
          const totalParams = skill?.params?.length ?? 0;
          const filledParams = totalParams > 0
            ? Object.values(node.paramValues).filter((v) => v.trim() !== "").length
            : 0;
          const requiredParams = skill?.params?.filter((p) => p.required) ?? [];
          const missingRequired = requiredParams.filter(
            (p) => !node.paramValues[p.name]?.trim(),
          );

          const StatusIcon = STATUS_ICON_MAP[node.status] ?? Circle;
          const isRunning = node.status === "running";

          return (
            <button
              key={node.id}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left"
              onClick={() => onNodeClick(node.id)}
            >
              <StatusIcon
                className={`h-3.5 w-3.5 shrink-0 ${
                  node.status === "done"
                    ? "text-green-500"
                    : node.status === "error"
                      ? "text-red-500"
                      : node.status === "running"
                        ? "text-blue-500 animate-spin"
                        : node.status === "checkpoint"
                          ? "text-amber-500"
                          : "text-muted-foreground"
                }${isRunning ? " animate-spin" : ""}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{skillName}</div>
                {totalParams > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    {filledParams}/{totalParams}{" "}
                    {isZh ? "参数" : "params"}
                  </div>
                )}
              </div>
              {missingRequired.length > 0 && (
                <span
                  title={
                    isZh
                      ? `缺少必填参数: ${missingRequired.map((p) => p.name).join(", ")}`
                      : `Missing required: ${missingRequired.map((p) => p.name).join(", ")}`
                  }
                >
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function LeftPanel({
  locale,
  workspacePath,
  nodes,
  onNodeClick,
  collapsed,
  onToggleCollapse,
}: LeftPanelProps) {
  const isZh = locale === "zh-CN";
  const [activeTab, setActiveTab] = useState<TabId>("skills");

  const handleIconClick = (tab: TabId) => {
    if (collapsed) {
      // Expand and switch to clicked tab
      onToggleCollapse();
      setActiveTab(tab);
    } else {
      setActiveTab(tab);
    }
  };

  // Collapsed mode: icon-only vertical bar
  if (collapsed) {
    return (
      <div className="w-10 border-r bg-background flex flex-col items-center py-2 gap-1 shrink-0 transition-all duration-200">
        {TAB_ORDER.map((tab) => {
          const { Icon, label, labelZh } = TAB_META[tab];
          return (
            <Button
              key={tab}
              size="sm"
              variant={activeTab === tab ? "secondary" : "ghost"}
              className="h-8 w-8 p-0"
              onClick={() => handleIconClick(tab)}
              title={isZh ? labelZh : label}
            >
              <Icon className="h-4 w-4" />
            </Button>
          );
        })}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={onToggleCollapse}
          title={isZh ? "展开面板" : "Expand panel"}
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Expanded mode
  return (
    <div className="w-[220px] border-r bg-background flex flex-col h-full shrink-0 transition-all duration-200">
      {/* Tab bar */}
      <div className="flex items-center border-b">
        <div className="flex flex-1">
          {TAB_ORDER.map((tab) => {
            const { Icon, label, labelZh } = TAB_META[tab];
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                className={`flex items-center gap-1 px-3 py-2 text-[11px] font-medium transition-colors border-b-2 ${
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab(tab)}
              >
                <Icon className="h-3 w-3" />
                {isZh ? labelZh : label}
              </button>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 mr-1"
          onClick={onToggleCollapse}
          title={isZh ? "收起面板" : "Collapse panel"}
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "skills" && <SkillsTab isZh={isZh} />}
        {activeTab === "files" && (
          <FilesTab workspacePath={workspacePath} isZh={isZh} />
        )}
        {activeTab === "overview" && (
          <OverviewTab nodes={nodes} onNodeClick={onNodeClick} isZh={isZh} />
        )}
      </div>
    </div>
  );
}
