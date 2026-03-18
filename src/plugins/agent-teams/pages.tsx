"use client";

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Users, Plus, Search, Trash2, Loader2,
  Brain, GitBranch, Layers, PencilRuler, ArrowLeft, History,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useToast } from "@/components/toast";
import type { AgentTeam, TeamPreset } from "./types";
import { TEAM_PRESETS } from "./team-data";
import { TeamCard } from "./components/team-card";
import { TeamEditor } from "./components/team-editor";
import { PresetGallery } from "./components/preset-gallery";
import { RunsPanel } from "./components/runs-panel";
import * as store from "./team-store";

// Lazy-load canvas for Turbopack compatibility
const TeamCanvas = lazy(() =>
  import("./components/team-canvas").then((m) => ({ default: m.TeamCanvas }))
);

function generateMemberId(): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type ViewTab = "teams" | "presets" | "canvas" | "history";

export function AgentTeamsPage() {
  const t = useTranslations("agentTeams");
  const locale = useLocale();
  const isZh = locale === "zh-CN";
  const { toast } = useToast();
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterWorkflow, setFilterWorkflow] = useState<string>("all");
  const [tab, setTab] = useState<ViewTab>("teams");

  // Canvas state
  const [canvasTeam, setCanvasTeam] = useState<AgentTeam | null>(null);

  // History state — which team to show runs for
  const [historyTeam, setHistoryTeam] = useState<AgentTeam | null>(null);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<AgentTeam | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<AgentTeam | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadTeams = useCallback(() => {
    setTeams(store.getTeams());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // Filter teams
  const filteredTeams = useMemo(() => {
    return teams.filter((t) => {
      if (filterWorkflow !== "all" && t.workflow !== filterWorkflow) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          t.members.some((m) => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [teams, search, filterWorkflow]);

  // Stats
  const stats = useMemo(() => ({
    total: teams.length,
    totalMembers: teams.reduce((sum, t) => sum + t.members.length, 0),
    providers: {
      claude: teams.reduce((sum, t) => sum + t.members.filter((m) => m.provider === "claude").length, 0),
      codex: teams.reduce((sum, t) => sum + t.members.filter((m) => m.provider === "codex").length, 0),
    },
  }), [teams]);

  // Handlers
  const handleCreateTeam = () => {
    setEditingTeam(null);
    setEditorOpen(true);
  };

  const handleEditTeam = (team: AgentTeam) => {
    setEditingTeam(team);
    setEditorOpen(true);
  };

  const handleOpenCanvas = useCallback((team: AgentTeam) => {
    setCanvasTeam(team);
    setTab("canvas");
  }, []);

  const handleOpenHistory = useCallback((team: AgentTeam) => {
    setHistoryTeam(team);
    setTab("history");
  }, []);

  const handleCanvasBack = useCallback(() => {
    setTab("teams");
    setCanvasTeam(null);
    loadTeams(); // Refresh in case canvas saved changes
  }, [loadTeams]);

  const handleHistoryBack = useCallback(() => {
    setTab("teams");
    setHistoryTeam(null);
  }, []);

  const handleCanvasTeamUpdate = useCallback((updatedTeam: AgentTeam) => {
    setCanvasTeam(updatedTeam);
  }, []);

  const handleSave = useCallback((data: Omit<AgentTeam, "id" | "created_at" | "updated_at">) => {
    setSaving(true);
    try {
      if (editingTeam) {
        store.updateTeam(editingTeam.id, data);
        toast(t("teamUpdated"), "success");
      } else {
        store.createTeam(data);
        toast(t("teamCreated"), "success");
      }
      loadTeams();
      setEditorOpen(false);
    } catch {
      toast(t("saveFailed"), "error");
    }
    setSaving(false);
  }, [editingTeam, loadTeams, toast, t]);

  const handleClone = useCallback((team: AgentTeam) => {
    const cloned = store.cloneTeam(team.id, `${team.name} (Copy)`);
    if (cloned) {
      toast(t("teamCloned", { name: team.name }), "success");
      loadTeams();
    }
  }, [loadTeams, toast, t]);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    setDeleting(true);
    store.deleteTeam(deleteTarget.id);
    toast(t("teamDeleted", { name: deleteTarget.name }), "success");
    setDeleteTarget(null);
    setDeleting(false);
    loadTeams();
  }, [deleteTarget, loadTeams, toast, t]);

  const handleUsePreset = useCallback((preset: TeamPreset) => {
    store.createTeam({
      name: preset.name,
      description: preset.description,
      icon: preset.icon,
      workflow: preset.workflow,
      members: preset.members.map((m) => ({
        ...m,
        id: generateMemberId(),
      })),
      tags: preset.tags,
      isPreset: true,
      presetId: preset.id,
    });
    toast(t("createdFromPreset", { name: preset.name }), "success");
    loadTeams();
    setTab("teams");
  }, [loadTeams, toast, t]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-lg border bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Canvas view — takes full height
  if (tab === "canvas" && canvasTeam) {
    return (
      <div className="flex flex-col h-[calc(100vh-120px)]">
        {/* Back button bar */}
        <div className="flex items-center gap-2 pb-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleCanvasBack}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            {t("canvas.backToTeams")}
          </Button>
        </div>

        {/* Canvas */}
        <div className="flex-1 border rounded-lg overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full bg-background">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {isZh ? "加载可视化编辑器..." : "Loading Visual Editor..."}
                  </span>
                </div>
              </div>
            }
          >
            <TeamCanvas
              team={canvasTeam}
              onTeamUpdate={handleCanvasTeamUpdate}
              locale={locale}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  // History view
  if (tab === "history" && historyTeam) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleHistoryBack}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            {t("canvas.backToTeams")}
          </Button>
          <div className="w-px h-5 bg-border" />
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t("runs.title")} — {historyTeam.name}
          </span>
        </div>
        <RunsPanel teamId={historyTeam.id} isZh={isZh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleCreateTeam}>
            <Plus className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">{t("newTeam")}</span>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t("stats.teams"), value: stats.total.toString(), icon: Users, color: "text-blue-500" },
          { label: t("stats.members"), value: stats.totalMembers.toString(), icon: GitBranch, color: "text-purple-500" },
          { label: t("stats.claude"), value: stats.providers.claude.toString(), icon: Brain, color: "text-orange-500" },
          { label: t("stats.codex"), value: stats.providers.codex.toString(), icon: Layers, color: "text-green-500" },
        ].map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 rounded-lg border p-3 bg-card">
            <stat.icon className={`h-4 w-4 ${stat.color}`} />
            <div>
              <div className="text-lg font-bold">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border bg-muted p-0.5">
          <button
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${tab === "teams" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("teams")}
          >
            {t("myTeams")} ({teams.length})
          </button>
          <button
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${tab === "presets" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("presets")}
          >
            {t("presets")} ({TEAM_PRESETS.length})
          </button>
        </div>

        {tab === "teams" && teams.length > 0 && (
          <div className="flex flex-1 gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
            <Select value={filterWorkflow} onValueChange={setFilterWorkflow}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allWorkflows")}</SelectItem>
                <SelectItem value="sequential">{t("sequential")}</SelectItem>
                <SelectItem value="parallel">{t("parallel")}</SelectItem>
                <SelectItem value="hierarchical">{t("hierarchical")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Content */}
      {tab === "presets" ? (
        <PresetGallery onUsePreset={handleUsePreset} />
      ) : filteredTeams.length === 0 && teams.length === 0 ? (
        <Card>
          <CardHeader className="items-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <CardTitle>{t("noTeams")}</CardTitle>
            <CardDescription className="text-center max-w-md">
              {t("noTeamsDesc")}
            </CardDescription>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleCreateTeam}>
                <Plus className="h-4 w-4 mr-1" />
                {t("createTeam")}
              </Button>
              <Button variant="outline" onClick={() => setTab("presets")}>
                {t("browsePresets")}
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : filteredTeams.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {t("noMatch")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              onEdit={() => handleEditTeam(team)}
              onClone={() => handleClone(team)}
              onDelete={() => setDeleteTarget(team)}
              onOpenCanvas={() => handleOpenCanvas(team)}
              onOpenHistory={() => handleOpenHistory(team)}
            />
          ))}
        </div>
      )}

      {/* Team Editor Dialog */}
      <TeamEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        team={editingTeam}
        onSave={handleSave}
        saving={saving}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTeam")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirm", { name: deleteTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
