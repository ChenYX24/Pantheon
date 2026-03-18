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

function autoLayout(skills: SkillTreeNode[], isZh: boolean, statusMap: Map<string, SkillStatus>): { nodes: Node[]; edges: Edge[]; tierBands: { tier: number; y: number }[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 100, nodesep: 40, marginx: 80, marginy: 40 });

  for (const skill of skills) {
    // ST-4: Tier-based node sizing — higher tier nodes are slightly larger
    const tierScale = skill.tier <= 1 ? 1.15 : skill.tier <= 2 ? 1.05 : 1.0;
    const w = Math.round(NODE_WIDTH * tierScale);
    const h = Math.round(NODE_HEIGHT * tierScale);
    g.setNode(skill.id, { width: w, height: h });
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

  // ST-4: Adjust Y positions so nodes are grouped by tier level
  // Compute tier band positions: each tier gets a fixed vertical band
  const TIER_GAP = 180; // vertical gap between tiers
  const tiers = [...new Set(skills.map((s) => s.tier))].sort((a, b) => a - b);
  const tierYMap = new Map<number, number>();
  tiers.forEach((tier, index) => {
    tierYMap.set(tier, index * TIER_GAP);
  });

  // Compute per-tier average dagre Y for centering within the tier band
  const tierDagreYs = new Map<number, number[]>();
  for (const skill of skills) {
    const pos = g.node(skill.id);
    if (!tierDagreYs.has(skill.tier)) tierDagreYs.set(skill.tier, []);
    tierDagreYs.get(skill.tier)!.push(pos.y);
  }
  const tierAvgY = new Map<number, number>();
  for (const [tier, ys] of tierDagreYs) {
    tierAvgY.set(tier, ys.reduce((a, b) => a + b, 0) / ys.length);
  }

  const nodes: Node[] = skills.map((skill) => {
    const pos = g.node(skill.id);
    const status = statusMap.get(skill.id) ?? skill.defaultStatus;
    // Shift Y: move from dagre's avg Y for this tier to the fixed tier band Y
    const targetY = tierYMap.get(skill.tier) ?? pos.y;
    const avgY = tierAvgY.get(skill.tier) ?? pos.y;
    const adjustedY = pos.y - avgY + targetY;
    const tierScale = skill.tier <= 1 ? 1.15 : skill.tier <= 2 ? 1.05 : 1.0;
    const w = Math.round(NODE_WIDTH * tierScale);
    const h = Math.round(NODE_HEIGHT * tierScale);
    return {
      id: skill.id,
      type: "skill-hex",
      position: { x: pos.x - w / 2, y: adjustedY - h / 2 },
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

  // Compute tier band center positions for labels
  const tierBands = tiers.map((tier) => ({
    tier,
    y: tierYMap.get(tier) ?? 0,
  }));

  return { nodes, edges, tierBands };
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
  const [tierBands, setTierBands] = useState<{ tier: number; y: number }[]>([]);

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
    const { nodes: layoutNodes, edges: layoutEdges, tierBands: bands } = autoLayout(filteredSkills, isZh, statusMap);
    setNodes(layoutNodes);
    setEdges(layoutEdges);
    setTierBands(bands);
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
    // ST-3: Dependency enforcement — block activation if deps not active
    if (status === "active") {
      const skill = allSkills.find((s) => s.id === skillId);
      if (skill && skill.dependencies.length > 0) {
        const missing = skill.dependencies
          .map((depId) => {
            const depSkill = allSkills.find((s) => s.id === depId);
            if (!depSkill) return null;
            const depStatus = statusMap.get(depId) ?? depSkill.defaultStatus;
            return depStatus !== "active" ? depSkill : null;
          })
          .filter(Boolean) as SkillTreeNode[];
        if (missing.length > 0) {
          // Block — the visual warning in detail panel already shows the issue
          return;
        }
      }
    }
    const newState = await setSkillStatus(skillId, status);
    setTreeState(newState);
  }, [allSkills, statusMap]);

  // ST-3: Force status change (bypasses dep check) — used by detect/verify
  const handleForceStatusChange = useCallback(async (skillId: string, status: SkillStatus) => {
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

          {/* ST-4: Tier level legend */}
          {tierBands.length > 0 && (
            <div className="absolute top-14 left-3 flex flex-col gap-1 bg-zinc-950/80 backdrop-blur-sm rounded-lg px-2.5 py-2 border border-zinc-800">
              <div className="text-[9px] text-zinc-500 font-medium mb-0.5">
                {isZh ? "技能层级" : "Tier Levels"}
              </div>
              {tierBands.map(({ tier }) => {
                const opacity = tier <= 1 ? "text-zinc-200" : tier <= 2 ? "text-zinc-300" : tier <= 3 ? "text-zinc-400" : "text-zinc-500";
                const barWidth = `${Math.max(100 - (tier - 1) * 18, 20)}%`;
                return (
                  <div key={tier} className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold w-5 ${opacity}`}>T{tier}</span>
                    <div className="w-12 h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 transition-all"
                        style={{ width: barWidth, opacity: 1 - (tier - 1) * 0.15 }}
                      />
                    </div>
                    <span className="text-[8px] text-zinc-600">
                      {tier === 1 ? (isZh ? "核心" : "Core") :
                       tier === 2 ? (isZh ? "基础" : "Basic") :
                       tier === 3 ? (isZh ? "中级" : "Mid") :
                       tier === 4 ? (isZh ? "高级" : "Adv") :
                       isZh ? "专家" : "Expert"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedSkill && (
          <SkillDetailPanel
            skill={selectedSkill}
            effectiveStatus={statusMap.get(selectedSkill.id) ?? selectedSkill.defaultStatus}
            allSkills={allSkills}
            statusMap={statusMap}
            onStatusChange={handleStatusChange}
            onForceStatusChange={handleForceStatusChange}
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
