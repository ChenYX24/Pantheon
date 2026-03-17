"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

import type { SkillTreeNode, SkillStatus, SkillCategory, SkillTreeState } from "../types";
import { SKILL_TREE_NODES, CATEGORIES } from "../skill-tree-data";
import { getSkillTreeState, setSkillStatus, saveSkillTreeState } from "../skill-tree-store";
import { nodeTypes, type SkillHexNodeData } from "./skill-hex-node";
import { SkillDetailPanel } from "./skill-detail-panel";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const NODE_WIDTH = 120;
const NODE_HEIGHT = 130;

function autoLayout(skills: SkillTreeNode[], isZh: boolean, statusMap: Map<string, SkillStatus>): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 100, nodesep: 40, marginx: 40, marginy: 40 });

  for (const skill of skills) {
    g.setNode(skill.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const edges: Edge[] = [];
  for (const skill of skills) {
    for (const depId of skill.dependencies) {
      if (skills.find((s) => s.id === depId)) {
        const edgeId = `e-${depId}-${skill.id}`;
        g.setEdge(depId, skill.id);
        const srcStatus = statusMap.get(depId) ?? "planned";
        const tgtStatus = statusMap.get(skill.id) ?? "planned";
        const isActive = srcStatus === "active" && tgtStatus === "active";
        edges.push({
          id: edgeId,
          source: depId,
          target: skill.id,
          style: {
            strokeWidth: isActive ? 2 : 1,
            stroke: isActive ? CATEGORIES.find((c) => c.id === skill.category)?.glowColor ?? "#4ade80" : "#3f3f46",
            opacity: isActive ? 0.8 : 0.3,
          },
          animated: isActive,
        });
      }
    }
  }

  dagre.layout(g);

  const nodes: Node[] = skills.map((skill) => {
    const pos = g.node(skill.id);
    const status = statusMap.get(skill.id) ?? skill.defaultStatus;
    return {
      id: skill.id,
      type: "skill-hex",
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        skillId: skill.id,
        name: skill.name,
        nameZh: skill.nameZh,
        icon: skill.icon,
        category: skill.category,
        status,
        tier: skill.tier,
        isZh,
        implType: skill.implType,
      } satisfies SkillHexNodeData,
    };
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

interface TreeStats {
  total: number;
  active: number;
  configurable: number;
  planned: number;
  disabled: number;
}

function computeStats(skills: SkillTreeNode[], statusMap: Map<string, SkillStatus>): TreeStats {
  const stats: TreeStats = { total: skills.length, active: 0, configurable: 0, planned: 0, disabled: 0 };
  for (const s of skills) {
    const st = statusMap.get(s.id) ?? s.defaultStatus;
    stats[st]++;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterBar({
  stats,
  filter,
  onFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  isZh,
}: {
  stats: TreeStats;
  filter: SkillStatus | "all";
  onFilterChange: (f: SkillStatus | "all") => void;
  categoryFilter: SkillCategory | "all";
  onCategoryFilterChange: (c: SkillCategory | "all") => void;
  isZh: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-background/80 backdrop-blur-sm flex-wrap">
      {/* Status filters */}
      <div className="flex gap-1">
        {([
          { key: "all" as const, label: isZh ? "全部" : "All", count: stats.total, color: "bg-zinc-600" },
          { key: "active" as const, label: isZh ? "已激活" : "Active", count: stats.active, color: "bg-emerald-500" },
          { key: "configurable" as const, label: isZh ? "需配置" : "Setup", count: stats.configurable, color: "bg-amber-500" },
          { key: "planned" as const, label: isZh ? "规划中" : "Planned", count: stats.planned, color: "bg-zinc-500" },
          { key: "disabled" as const, label: isZh ? "已禁用" : "Off", count: stats.disabled, color: "bg-zinc-700" },
        ]).map((f) => (
          <button
            key={f.key}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              filter === f.key ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
            }`}
            onClick={() => onFilterChange(f.key)}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${f.color}`} />
            {f.label}
            <span className="opacity-60">{f.count}</span>
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-border mx-1" />

      {/* Category filters */}
      <div className="flex gap-1">
        <button
          className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
            categoryFilter === "all" ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
          }`}
          onClick={() => onCategoryFilterChange("all")}
        >
          {isZh ? "全部类别" : "All"}
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              categoryFilter === cat.id ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
            }`}
            style={categoryFilter === cat.id ? { backgroundColor: cat.glowColor + "30", color: cat.glowColor } : undefined}
            onClick={() => onCategoryFilterChange(cat.id)}
          >
            {isZh ? cat.nameZh : cat.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner canvas
// ---------------------------------------------------------------------------

function TreeCanvasInner({ locale }: { locale: string }) {
  const isZh = locale === "zh-CN";
  const { fitView } = useReactFlow();

  const [treeState, setTreeState] = useState<SkillTreeState>({ overrides: [], customSkills: [] });
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SkillStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<SkillCategory | "all">("all");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // All skills (preset + custom)
  const allSkills = useMemo(
    () => [...SKILL_TREE_NODES, ...treeState.customSkills],
    [treeState.customSkills]
  );

  // Status map (override > default)
  const statusMap = useMemo(() => {
    const map = new Map<string, SkillStatus>();
    for (const s of allSkills) map.set(s.id, s.defaultStatus);
    for (const o of treeState.overrides) map.set(o.skillId, o.status);
    return map;
  }, [allSkills, treeState.overrides]);

  // Filtered skills
  const filteredSkills = useMemo(() => {
    return allSkills.filter((s) => {
      if (statusFilter !== "all" && (statusMap.get(s.id) ?? s.defaultStatus) !== statusFilter) return false;
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      return true;
    });
  }, [allSkills, statusMap, statusFilter, categoryFilter]);

  const stats = useMemo(() => computeStats(allSkills, statusMap), [allSkills, statusMap]);

  // Load state + build layout
  useEffect(() => {
    getSkillTreeState().then((state) => {
      setTreeState(state);
    });
  }, []);

  // Rebuild layout when filters or state change
  useEffect(() => {
    const { nodes: layoutNodes, edges: layoutEdges } = autoLayout(filteredSkills, isZh, statusMap);
    setNodes(layoutNodes);
    setEdges(layoutEdges);
    setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 100);
  }, [filteredSkills, isZh, statusMap, setNodes, setEdges, fitView]);

  // Handlers
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedSkillId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedSkillId(null);
  }, []);

  const handleStatusChange = useCallback(async (skillId: string, status: SkillStatus) => {
    const newState = await setSkillStatus(skillId, status);
    setTreeState(newState);
  }, []);

  const selectedSkill = useMemo(
    () => allSkills.find((s) => s.id === selectedSkillId) ?? null,
    [allSkills, selectedSkillId]
  );

  return (
    <div className="flex flex-col h-full">
      <FilterBar
        stats={stats}
        filter={statusFilter}
        onFilterChange={setStatusFilter}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        isZh={isZh}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-zinc-950"
            minZoom={0.3}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
            <Controls className="!bg-zinc-900 !border-zinc-700 !shadow-lg" />
            <MiniMap
              className="!bg-zinc-900 !border-zinc-700"
              nodeColor={(n) => {
                const st = n.data?.status as string;
                if (st === "active") return "#34d399";
                if (st === "configurable") return "#fbbf24";
                if (st === "disabled") return "#3f3f46";
                return "#71717a";
              }}
            />
          </ReactFlow>

          {/* Stats overlay */}
          <div className="absolute top-3 left-3 flex items-center gap-3 bg-zinc-950/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-zinc-800">
            <div className="text-[10px]">
              <span className="text-emerald-400 font-bold">{stats.active}</span>
              <span className="text-zinc-500"> / {stats.total} {isZh ? "技能" : "skills"}</span>
            </div>
            <div className="w-24 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${(stats.active / Math.max(stats.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selectedSkill && (
          <SkillDetailPanel
            skill={selectedSkill}
            effectiveStatus={statusMap.get(selectedSkill.id) ?? selectedSkill.defaultStatus}
            allSkills={allSkills}
            onStatusChange={handleStatusChange}
            onClose={() => setSelectedSkillId(null)}
            isZh={isZh}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function TreeCanvas({ locale }: { locale: string }) {
  return (
    <ReactFlowProvider>
      <TreeCanvasInner locale={locale} />
    </ReactFlowProvider>
  );
}
