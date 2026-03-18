"use client";

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TreePine,
  Search,
  CheckCircle,
  Settings,
  Clock,
  Ban,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  X,
  List,
  Network,
  Loader2,
  Plus,
  ScanSearch,
  Pencil,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

const TreeCanvas = lazy(() =>
  import("./components/tree-canvas").then((m) => ({ default: m.TreeCanvas }))
);

type ViewMode = "list" | "graph";
import type {
  SkillTreeNode,
  SkillStatus,
  SkillCategory,
  SkillTreeState,
  CustomSkill,
} from "./types";
import { SKILL_TREE_NODES, CATEGORIES } from "./skill-tree-data";
import {
  getSkillTreeState,
  saveSkillTreeState,
  setSkillStatus,
  addCustomSkill,
  updateCustomSkill,
  removeCustomSkill,
} from "./skill-tree-store";
import { CustomSkillDialog } from "./components/custom-skill-dialog";
import { DeleteSkillDialog } from "./components/delete-skill-dialog";
import { SmartCreateDialog } from "./components/smart-create-dialog";
import { SkillConfigPanel } from "./components/skill-config-panel";

// ---------------------------------------------------------------------------
// Detect helper
// ---------------------------------------------------------------------------

async function runDetect(
  command: string,
  params?: Record<string, string>
): Promise<{ success: boolean; output: string }> {
  try {
    const res = await fetch("/api/plugins/skill-tree/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, params }),
    });
    return await res.json();
  } catch {
    return { success: false, output: "Network error" };
  }
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

function makeStatusConfig(t: (key: string) => string) {
  return {
    active: {
      icon: <CheckCircle className="h-3 w-3" />,
      label: t("status.active"),
      dot: "bg-emerald-400",
      bg: "bg-emerald-500/5",
      border: "border-emerald-500/20 hover:border-emerald-500/40",
      glow: "shadow-emerald-500/10 shadow-sm",
    },
    configurable: {
      icon: <Settings className="h-3 w-3" />,
      label: t("status.configurable"),
      dot: "bg-amber-400",
      bg: "bg-amber-500/5",
      border: "border-amber-500/20 hover:border-amber-500/40",
      glow: "",
    },
    planned: {
      icon: <Clock className="h-3 w-3" />,
      label: t("status.planned"),
      dot: "bg-zinc-500",
      bg: "bg-zinc-500/5",
      border: "border-zinc-500/10 hover:border-zinc-500/20",
      glow: "",
    },
    disabled: {
      icon: <Ban className="h-3 w-3" />,
      label: t("status.disabled"),
      dot: "bg-zinc-700",
      bg: "bg-zinc-800/5",
      border: "border-zinc-700/10",
      glow: "",
    },
  } as const;
}

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

function SkillCard({
  skill,
  status,
  isZh,
  selected,
  onClick,
  isCustom,
  statusConfig,
  t,
}: {
  skill: SkillTreeNode;
  status: SkillStatus;
  isZh: boolean;
  selected: boolean;
  onClick: () => void;
  isCustom: boolean;
  statusConfig: ReturnType<typeof makeStatusConfig>;
  t: (key: string) => string;
}) {
  const cfg = statusConfig[status];

  return (
    <button
      className={`
        w-full text-left rounded-lg border p-2.5 transition-all duration-200 cursor-pointer
        ${cfg.bg} ${cfg.border} ${cfg.glow}
        ${selected ? "ring-2 ring-primary scale-[1.02]" : ""}
        ${status === "disabled" ? "opacity-40" : ""}
        ${status === "planned" ? "opacity-60" : ""}
      `}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${cfg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold truncate">
              {isZh ? skill.nameZh : skill.name}
            </span>
            {isCustom && (
              <Badge
                variant="outline"
                className="text-[8px] px-1 py-0 border-violet-500/30 text-violet-400 shrink-0"
              >
                {t("custom.customBadge")}
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
            {isZh ? skill.descriptionZh : skill.description}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Category Section
// ---------------------------------------------------------------------------

function CategorySection({
  category,
  skills,
  statusMap,
  isZh,
  selectedId,
  onSelect,
  collapsed,
  onToggle,
  customSkillIds,
  statusConfig,
  t,
}: {
  category: (typeof CATEGORIES)[number];
  skills: SkillTreeNode[];
  statusMap: Map<string, SkillStatus>;
  isZh: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  customSkillIds: Set<string>;
  statusConfig: ReturnType<typeof makeStatusConfig>;
  t: (key: string) => string;
}) {
  const activeCount = skills.filter(
    (s) => (statusMap.get(s.id) ?? s.defaultStatus) === "active"
  ).length;
  const sorted = [...skills].sort((a, b) => a.tier - b.tier);

  return (
    <div className="space-y-1.5">
      <button
        className="flex items-center gap-2 w-full px-1 py-1 rounded hover:bg-accent/50 transition-colors"
        onClick={onToggle}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span
          className="text-xs font-bold"
          style={{ color: category.glowColor }}
        >
          {isZh ? category.nameZh : category.name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {activeCount}/{skills.length}
        </span>
        <div className="flex-1 h-1 rounded-full bg-muted/50 max-w-[60px]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${(activeCount / Math.max(skills.length, 1)) * 100}%`,
              backgroundColor: category.glowColor,
            }}
          />
        </div>
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-1 pl-5">
          {sorted.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              status={statusMap.get(skill.id) ?? skill.defaultStatus}
              isZh={isZh}
              selected={selectedId === skill.id}
              onClick={() => onSelect(skill.id)}
              isCustom={customSkillIds.has(skill.id)}
              statusConfig={statusConfig}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function DetailPanel({
  skill,
  status,
  allSkills,
  statusMap,
  isZh,
  onClose,
  onStatusChange,
  onForceStatusChange,
  onNavigate,
  isCustom,
  onEdit,
  onDelete,
  t,
  statusConfig,
}: {
  skill: SkillTreeNode;
  status: SkillStatus;
  allSkills: SkillTreeNode[];
  statusMap: Map<string, SkillStatus>;
  isZh: boolean;
  onClose: () => void;
  onStatusChange: (id: string, s: SkillStatus) => void;
  /** Bypass dependency check (used by detect/verify) */
  onForceStatusChange: (id: string, s: SkillStatus) => void;
  onNavigate: (route: string) => void;
  isCustom: boolean;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  statusConfig: ReturnType<typeof makeStatusConfig>;
}) {
  const cat = CATEGORIES.find((c) => c.id === skill.category);
  const cfg = statusConfig[status];
  const deps = skill.dependencies
    .map((id) => allSkills.find((s) => s.id === id))
    .filter(Boolean) as SkillTreeNode[];
  const unlocks = allSkills.filter((s) => s.dependencies.includes(skill.id));

  // ST-3: Check if dependencies are met
  const missingDeps = deps.filter((d) => {
    const depStatus = statusMap.get(d.id) ?? d.defaultStatus;
    return depStatus !== "active";
  });
  const depsNotMet = missingDeps.length > 0;

  const canActivate =
    skill.defaultStatus === "active" || skill.defaultStatus === "configurable";
  const canDisable = status !== "planned";

  // Detect state
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<{
    success: boolean;
    output: string;
  } | null>(null);
  const { toast } = useToast();

  const handleDetect = useCallback(async () => {
    if (!skill.detectCommand) return;
    setDetecting(true);
    setDetectResult(null);
    // Load skill config params for ${variable} substitution
    const { getSkillConfig } = await import("./skill-tree-store");
    const config = await getSkillConfig(skill.id);
    const result = await runDetect(skill.detectCommand, config.params);
    setDetectResult(result);
    setDetecting(false);
    if (result.success) {
      toast(t("detect.success"), "success");
      // ST-3: Detect bypasses dependency check — verified skills can force-activate
      onForceStatusChange(skill.id, "active");
    } else {
      toast(t("detect.failed"), "error");
    }
  }, [skill, onForceStatusChange, toast, t]);

  return (
    <div className="w-[340px] border-l bg-background flex flex-col h-full overflow-hidden shrink-0">
      {/* Header */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderLeftColor: cat?.glowColor, borderLeftWidth: 3 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold">
              {isZh ? skill.nameZh : skill.name}
            </h3>
            {isCustom && (
              <Badge
                variant="outline"
                className="text-[8px] px-1 py-0 border-violet-500/30 text-violet-400"
              >
                {t("custom.customBadge")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {isCustom && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={onEdit}
                  title={t("custom.editSkill")}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={onDelete}
                  title={t("custom.deleteSkill")}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <Badge
            className="text-[9px] px-1.5 py-0 border-0 gap-1"
            style={{
              backgroundColor: `${cat?.glowColor}15`,
              color: cat?.glowColor,
            }}
          >
            {isZh ? cat?.nameZh : cat?.name}
          </Badge>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0">
            T{skill.tier}
          </Badge>
          <Badge
            className={`text-[9px] px-1.5 py-0 border-0 gap-1 ${cfg.bg}`}
          >
            {cfg.icon}
            {cfg.label}
          </Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isZh ? skill.descriptionZh : skill.description}
        </p>

        {/* ST-3: Dependency warning */}
        {depsNotMet && status !== "active" && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[10px] text-amber-400 leading-relaxed">
              {isZh
                ? `依赖未满足：需要先激活 ${missingDeps.map((d) => d.nameZh).join(", ")}`
                : `Dependencies not met: ${missingDeps.map((d) => d.name).join(", ")} need to be activated first`}
            </div>
          </div>
        )}

        {/* Status actions */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold">{t("actions")}</label>
          <div className="flex flex-wrap gap-1.5">
            {status === "disabled" && canActivate && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1"
                onClick={() =>
                  onStatusChange(
                    skill.id,
                    skill.defaultStatus === "active"
                      ? "active"
                      : "configurable"
                  )
                }
              >
                <CheckCircle className="h-3 w-3 text-emerald-400" />
                {t("reenable")}
              </Button>
            )}
            {status === "active" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 text-zinc-400"
                onClick={() => onStatusChange(skill.id, "disabled")}
              >
                <Ban className="h-3 w-3" />
                {t("disable")}
              </Button>
            )}
            {status === "planned" && (
              <div className="text-[10px] text-muted-foreground italic">
                {t("plannedHint")}
              </div>
            )}
            {status === "configurable" && (
              <div className="text-[10px] text-amber-400">
                {t("configurableHint")}
              </div>
            )}
          </div>
        </div>

        {/* Skill config fields */}
        {skill.configFields && skill.configFields.length > 0 && (
          <SkillConfigPanel
            skillId={skill.id}
            fields={skill.configFields}
            isZh={isZh}
          />
        )}

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
              {detecting ? t("detect.verifying") : t("detect.verifySetup")}
            </Button>

            {/* Detect result */}
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
                      ? t("detect.success")
                      : t("detect.failed")}
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
                      {t("detect.hint")}{" "}
                    </span>
                    {skill.detectHint}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Setup steps for configurable skills */}
        {skill.setupSteps && skill.setupSteps.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 space-y-2">
            <div className="text-[11px] font-semibold text-amber-400">
              {t("setupSteps")}
            </div>
            <ol className="space-y-1.5">
              {skill.setupSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-[10px]">
                  <span className="text-amber-500 font-mono shrink-0">
                    {i + 1}.
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
            {skill.detectHint && (
              <div className="text-[10px] text-muted-foreground border-t border-amber-500/10 pt-1.5 mt-1.5">
                <span className="font-medium text-amber-400">
                  {t("verify")}{" "}
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
            <label className="text-[11px] font-semibold">
              {t("implementation")}
            </label>
            <code className="block text-[10px] text-muted-foreground font-mono bg-muted rounded px-2 py-1.5 break-all">
              {skill.implDetail}
            </code>
          </div>
        )}

        {/* Dependencies */}
        {deps.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">
              {t("requires")}
            </label>
            <div className="flex flex-wrap gap-1">
              {deps.map((d) => {
                const depStatus = statusMap.get(d.id) ?? d.defaultStatus;
                return (
                  <Badge
                    key={d.id}
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 gap-1"
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${statusConfig[depStatus].dot}`}
                    />
                    {isZh ? d.nameZh : d.name}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Unlocks */}
        {unlocks.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold">
              {t("unlocks")}
            </label>
            <div className="flex flex-wrap gap-1">
              {unlocks.map((u) => (
                <Badge
                  key={u.id}
                  variant="outline"
                  className="text-[9px] px-1.5 py-0"
                >
                  {isZh ? u.nameZh : u.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skill.tags.map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Navigate */}
        {skill.pageRoute && (
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-xs gap-1.5"
            onClick={() => onNavigate(skill.pageRoute!)}
          >
            <ExternalLink className="h-3 w-3" />
            {t("openPage")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function SkillTreePage() {
  const locale = useLocale();
  const isZh = locale === "zh-CN";
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("skillTree");

  const statusConfig = useMemo(() => makeStatusConfig(t), [t]);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [treeState, setTreeState] = useState<SkillTreeState>({
    overrides: [],
    customSkills: [],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<SkillStatus | "all">("all");

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillTreeNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillTreeNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Smart create state
  const [showSmartDialog, setShowSmartDialog] = useState(false);

  // Scan all state
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    getSkillTreeState().then(setTreeState);
  }, []);

  const customSkillIds = useMemo(
    () => new Set(treeState.customSkills.map((s) => s.id)),
    [treeState.customSkills]
  );

  const allSkills = useMemo(
    () => [...SKILL_TREE_NODES, ...treeState.customSkills],
    [treeState.customSkills]
  );

  const statusMap = useMemo(() => {
    const map = new Map<string, SkillStatus>();
    for (const s of allSkills) map.set(s.id, s.defaultStatus);
    for (const o of treeState.overrides) map.set(o.skillId, o.status);
    return map;
  }, [allSkills, treeState.overrides]);

  // Stats
  const stats = useMemo(() => {
    const s = {
      total: allSkills.length,
      active: 0,
      configurable: 0,
      planned: 0,
      disabled: 0,
    };
    for (const sk of allSkills) {
      s[statusMap.get(sk.id) ?? sk.defaultStatus]++;
    }
    return s;
  }, [allSkills, statusMap]);

  // Group by category, apply filters
  const groupedSkills = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = allSkills.filter((s) => {
      if (
        statusFilter !== "all" &&
        (statusMap.get(s.id) ?? s.defaultStatus) !== statusFilter
      )
        return false;
      if (q) {
        return (
          s.name.toLowerCase().includes(q) ||
          s.nameZh.includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.descriptionZh.includes(q) ||
          s.tags?.some((tag) => tag.includes(q))
        );
      }
      return true;
    });

    const groups = new Map<SkillCategory, SkillTreeNode[]>();
    for (const cat of CATEGORIES) groups.set(cat.id, []);
    for (const s of filtered) {
      const list = groups.get(s.category);
      if (list) list.push(s);
    }
    for (const [key, val] of groups) {
      if (val.length === 0) groups.delete(key);
    }
    return groups;
  }, [allSkills, statusMap, statusFilter, searchQuery]);

  const selectedSkill = useMemo(
    () => allSkills.find((s) => s.id === selectedId) ?? null,
    [allSkills, selectedId]
  );

  const handleStatusChange = useCallback(
    async (skillId: string, status: SkillStatus) => {
      // ST-3: Dependency enforcement — block activation if deps not active
      if (status === "active") {
        const skill = allSkills.find((s) => s.id === skillId);
        if (skill && skill.dependencies.length > 0) {
          const missingDeps = skill.dependencies
            .map((depId) => {
              const depSkill = allSkills.find((s) => s.id === depId);
              if (!depSkill) return null;
              const depStatus = statusMap.get(depId) ?? depSkill.defaultStatus;
              return depStatus !== "active" ? depSkill : null;
            })
            .filter(Boolean) as SkillTreeNode[];
          if (missingDeps.length > 0) {
            const names = missingDeps
              .map((d) => (isZh ? d.nameZh : d.name))
              .join(", ");
            toast(
              isZh
                ? `依赖未满足：需要先激活 ${names}`
                : `Dependencies not met: ${names} need to be activated first`,
              "error"
            );
            return;
          }
        }
      }
      const newState = await setSkillStatus(skillId, status);
      setTreeState(newState);
    },
    [allSkills, statusMap, isZh, toast, t]
  );

  // ST-3: Force status change (bypasses dep check) — used by detect/verify
  const handleForceStatusChange = useCallback(
    async (skillId: string, status: SkillStatus) => {
      const newState = await setSkillStatus(skillId, status);
      setTreeState(newState);
    },
    []
  );

  const toggleCat = useCallback((catId: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  // --- Custom skill handlers ---
  const handleSaveCustomSkill = useCallback(
    async (data: Omit<CustomSkill, "isCustom" | "createdAt">) => {
      setSaving(true);
      try {
        if (editingSkill && customSkillIds.has(editingSkill.id)) {
          const newState = await updateCustomSkill(editingSkill.id, data);
          setTreeState(newState);
          toast(t("custom.updated"), "success");
          setEditingSkill(null);
        } else {
          const newState = await addCustomSkill(data);
          setTreeState(newState);
          toast(t("custom.created"), "success");
          setShowCreateDialog(false);
        }
      } catch {
        toast(t("custom.createFailed"), "error");
      } finally {
        setSaving(false);
      }
    },
    [editingSkill, customSkillIds, toast, t]
  );

  const handleDeleteCustomSkill = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const newState = await removeCustomSkill(deleteTarget.id);
      setTreeState(newState);
      toast(t("custom.deleted"), "success");
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) setSelectedId(null);
    } catch {
      toast(t("custom.deleteFailed"), "error");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, toast, t, selectedId]);

  // --- Scan all ---
  const handleScanAll = useCallback(async () => {
    setScanning(true);
    const detectableSkills = allSkills.filter((s) => s.detectCommand);
    let activeCount = 0;
    let failedCount = 0;

    for (const skill of detectableSkills) {
      const result = await runDetect(skill.detectCommand!);
      if (result.success) {
        activeCount++;
        await setSkillStatus(skill.id, "active");
      } else {
        failedCount++;
      }
    }

    // Refresh state
    const newState = await getSkillTreeState();
    setTreeState(newState);
    setScanning(false);

    toast(
      t("detect.scanComplete", { active: activeCount, failed: failedCount }),
      activeCount > 0 ? "success" : "info"
    );
  }, [allSkills, toast, t]);

  // --- Smart create handler ---
  const handleSmartConfirm = useCallback(
    async (skills: Omit<CustomSkill, "isCustom" | "createdAt">[]) => {
      try {
        let state = await getSkillTreeState();
        for (const skill of skills) {
          const custom: CustomSkill = {
            ...skill,
            isCustom: true,
            createdAt: new Date().toISOString(),
          };
          state = {
            ...state,
            customSkills: [...state.customSkills, custom],
          };
        }
        await saveSkillTreeState(state);
        setTreeState(state);
        toast(t("smart.created"), "success");
      } catch {
        toast(t("smart.createFailed"), "error");
      }
    },
    [toast, t]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 pb-3">
        <div className="flex items-center gap-2">
          <TreePine className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>

        {/* Action buttons + Stats */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Scan All */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1.5 border-sky-500/20 text-sky-400 hover:text-sky-300 hover:border-sky-500/40"
            onClick={handleScanAll}
            disabled={scanning}
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanSearch className="h-3.5 w-3.5" />
            )}
            {scanning ? t("detect.scanning") : t("detect.scanAll")}
          </Button>

          {/* Smart Add */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1.5 border-violet-500/30 bg-violet-500/5 text-violet-400 hover:text-violet-300 hover:border-violet-500/50 hover:bg-violet-500/10"
            onClick={() => setShowSmartDialog(true)}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {t("smart.smartAdd")}
          </Button>

          {/* Add Skill */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1.5 border-violet-500/20 text-violet-400 hover:text-violet-300 hover:border-violet-500/40"
            onClick={() => {
              setEditingSkill(null);
              setShowCreateDialog(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("custom.addSkill")}
          </Button>

          {/* Filter buttons */}
          {(
            [
              {
                key: "all" as const,
                label: t("filterAll"),
                count: stats.total,
                color: "",
              },
              {
                key: "active" as const,
                label: t("filterActive"),
                count: stats.active,
                color: "text-emerald-400",
              },
              {
                key: "configurable" as const,
                label: t("filterSetup"),
                count: stats.configurable,
                color: "text-amber-400",
              },
              {
                key: "planned" as const,
                label: t("filterPlan"),
                count: stats.planned,
                color: "text-zinc-400",
              },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              className={`flex items-center gap-1 text-xs transition-colors ${
                statusFilter === f.key
                  ? "font-bold"
                  : "text-muted-foreground hover:text-foreground"
              } ${f.color}`}
              onClick={() =>
                setStatusFilter(statusFilter === f.key ? "all" : f.key)
              }
            >
              {f.count} {f.label}
            </button>
          ))}

          {/* View toggle */}
          <div className="flex gap-0.5 border rounded-md p-0.5">
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setViewMode("list")}
              title={t("listView")}
            >
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === "graph" ? "default" : "ghost"}
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setViewMode("graph")}
              title={t("graphView")}
            >
              <Network className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="w-20 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{
                  width: `${(stats.active / Math.max(stats.total, 1)) * 100}%`,
                }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">
              {Math.round(
                (stats.active / Math.max(stats.total, 1)) * 100
              )}
              %
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      {viewMode === "graph" ? (
        <div className="flex-1 min-h-0 border rounded-lg overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{t("loadingGraph")}</span>
              </div>
            }
          >
            <TreeCanvas locale={locale} />
          </Suspense>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative px-1 pb-3">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 text-xs pl-8"
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-1 min-h-0 gap-0">
            {/* Skill list */}
            <div className="flex-1 overflow-y-auto px-1 pb-4 space-y-4">
              {Array.from(groupedSkills.entries()).map(([catId, skills]) => {
                const cat = CATEGORIES.find((c) => c.id === catId);
                if (!cat) return null;
                return (
                  <CategorySection
                    key={catId}
                    category={cat}
                    skills={skills}
                    statusMap={statusMap}
                    isZh={isZh}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    collapsed={collapsedCats.has(catId)}
                    onToggle={() => toggleCat(catId)}
                    customSkillIds={customSkillIds}
                    statusConfig={statusConfig}
                    t={t}
                  />
                );
              })}

              {groupedSkills.size === 0 && (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {t("noMatchingSkills")}
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selectedSkill && (
              <DetailPanel
                skill={selectedSkill}
                status={
                  statusMap.get(selectedSkill.id) ??
                  selectedSkill.defaultStatus
                }
                allSkills={allSkills}
                statusMap={statusMap}
                isZh={isZh}
                onClose={() => setSelectedId(null)}
                onStatusChange={handleStatusChange}
                onForceStatusChange={handleForceStatusChange}
                onNavigate={(route) => router.push(route)}
                isCustom={customSkillIds.has(selectedSkill.id)}
                onEdit={() => {
                  setEditingSkill(selectedSkill);
                  setShowCreateDialog(true);
                }}
                onDelete={() => setDeleteTarget(selectedSkill)}
                t={t}
                statusConfig={statusConfig}
              />
            )}
          </div>
        </>
      )}

      {/* Custom skill create/edit dialog */}
      <CustomSkillDialog
        open={showCreateDialog || !!editingSkill}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setEditingSkill(null);
          }
        }}
        allSkills={allSkills}
        editingSkill={editingSkill}
        onSave={handleSaveCustomSkill}
        saving={saving}
        t={t}
      />

      {/* Smart create dialog */}
      <SmartCreateDialog
        open={showSmartDialog}
        onOpenChange={setShowSmartDialog}
        allSkills={allSkills}
        isZh={isZh}
        onConfirm={handleSmartConfirm}
        t={t}
      />

      {/* Delete confirmation dialog */}
      <DeleteSkillDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        skillName={
          deleteTarget
            ? isZh
              ? deleteTarget.nameZh
              : deleteTarget.name
            : ""
        }
        onConfirm={handleDeleteCustomSkill}
        deleting={deleting}
        t={t}
      />
    </div>
  );
}

export default SkillTreePage;
