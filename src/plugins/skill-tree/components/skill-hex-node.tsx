"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SkillStatus, SkillCategory } from "../types";
import { CATEGORIES } from "../skill-tree-data";

// ---------------------------------------------------------------------------
// Status visual config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<SkillStatus, {
  ring: string;
  bg: string;
  glow: string;
  label: string;
  labelZh: string;
  opacity: string;
}> = {
  active: {
    ring: "ring-2 ring-emerald-400/60",
    bg: "bg-emerald-500/10",
    glow: "0 0 20px rgba(52, 211, 153, 0.4)",
    label: "Active",
    labelZh: "已激活",
    opacity: "opacity-100",
  },
  configurable: {
    ring: "ring-2 ring-amber-400/50",
    bg: "bg-amber-500/10",
    glow: "0 0 15px rgba(251, 191, 36, 0.3)",
    label: "Setup Needed",
    labelZh: "需配置",
    opacity: "opacity-90",
  },
  planned: {
    ring: "ring-1 ring-zinc-500/30",
    bg: "bg-zinc-500/5",
    glow: "none",
    label: "Planned",
    labelZh: "规划中",
    opacity: "opacity-50",
  },
  disabled: {
    ring: "ring-1 ring-zinc-700/30",
    bg: "bg-zinc-800/20",
    glow: "none",
    label: "Disabled",
    labelZh: "已禁用",
    opacity: "opacity-30",
  },
};

// ---------------------------------------------------------------------------
// Node data interface
// ---------------------------------------------------------------------------

export interface SkillHexNodeData {
  skillId: string;
  name: string;
  nameZh: string;
  icon: string;
  category: SkillCategory;
  status: SkillStatus;
  tier: number;
  isZh: boolean;
  implType: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Hex node component
// ---------------------------------------------------------------------------

function getCategoryColor(cat: SkillCategory): string {
  return CATEGORIES.find((c) => c.id === cat)?.glowColor ?? "#94a3b8";
}

function SkillHexNodeInner({ data, selected }: NodeProps & { data: SkillHexNodeData }) {
  const status = data.status ?? "planned";
  const cfg = STATUS_CONFIG[status];
  const catColor = getCategoryColor(data.category);
  const isZh = data.isZh;
  const displayName = isZh ? data.nameZh : data.name;

  // Tier-based size
  const size = data.tier <= 1 ? "w-[130px] h-[130px]" : data.tier <= 2 ? "w-[110px] h-[110px]" : "w-[100px] h-[100px]";
  const iconSize = data.tier <= 1 ? "text-2xl" : data.tier <= 2 ? "text-xl" : "text-lg";
  const textSize = data.tier <= 2 ? "text-[11px]" : "text-[10px]";

  return (
    <div className={`relative ${cfg.opacity} transition-all duration-300`}>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-3 !h-3" />

      {/* Hex shape via CSS clip-path */}
      <div
        className={`
          ${size} ${cfg.ring} ${cfg.bg}
          flex flex-col items-center justify-center
          rounded-2xl cursor-pointer
          transition-all duration-300
          ${selected ? "scale-110 ring-primary ring-2" : "hover:scale-105"}
        `}
        style={{
          clipPath: "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)",
          boxShadow: selected
            ? `0 0 30px ${catColor}80, ${cfg.glow}`
            : cfg.glow,
          background: status === "active"
            ? `radial-gradient(ellipse at center, ${catColor}15, transparent 70%)`
            : undefined,
        }}
      >
        {/* Icon */}
        <div className={`${iconSize} mb-1`} style={{ color: status === "active" ? catColor : undefined }}>
          {getIconChar(data.icon)}
        </div>

        {/* Name */}
        <div className={`${textSize} font-semibold text-center px-2 leading-tight max-w-[80px] truncate`}>
          {displayName}
        </div>

        {/* Status dot */}
        <div className="mt-1 flex items-center gap-1">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              status === "active" ? "bg-emerald-400" :
              status === "configurable" ? "bg-amber-400" :
              status === "planned" ? "bg-zinc-500" :
              "bg-zinc-700"
            }`}
          />
          <span className="text-[8px] text-muted-foreground">
            {isZh ? STATUS_CONFIG[status].labelZh : STATUS_CONFIG[status].label}
          </span>
        </div>
      </div>

      {/* Tier badge */}
      {data.tier <= 2 && (
        <div
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border"
          style={{
            backgroundColor: `${catColor}20`,
            borderColor: `${catColor}40`,
            color: catColor,
          }}
        >
          T{data.tier}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-3 !h-3" />
    </div>
  );
}

/** Simple icon character mapping (avoids importing all lucide icons dynamically) */
function getIconChar(iconName: string): string {
  const map: Record<string, string> = {
    Terminal: "\u2588",
    Cpu: "\u2699",
    GitBranch: "\u2387",
    Hexagon: "\u2B22",
    FileCode: "\u2263",
    LayoutDashboard: "\u25A3",
    Server: "\u2395",
    TestTube: "\u2697",
    SearchCode: "\u2315",
    Recycle: "\u267B",
    MonitorCheck: "\u2611",
    Shield: "\u26E8",
    Brain: "\u2738",
    FlaskConical: "\u2697",
    BookOpen: "\u2261",
    Lightbulb: "\u2600",
    Zap: "\u26A1",
    FileText: "\u2263",
    Search: "\u26B2",
    RefreshCcw: "\u21BA",
    Key: "\u2386",
    Users: "\u2615",
    ListTodo: "\u2610",
    MessageSquare: "\u25A3",
    Coins: "\u25CE",
    Wrench: "\u2692",
    Film: "\u25A0",
    Send: "\u2794",
    Image: "\u263A",
    Palette: "\u2740",
    MessageCircle: "\u25CB",
    Smartphone: "\u25A1",
    Hash: "#",
    Bell: "\u266B",
    Wand2: "\u2728",
    Boxes: "\u25A3",
    HelpCircle: "?",
    TrendingUp: "\u2197",
    Newspaper: "\u2261",
    Briefcase: "\u2637",
    TreePine: "\u2742",
    Blocks: "\u25A8",
    Code2: "</>",
    Settings2: "\u2699",
    Plug: "\u2B58",
    Sparkles: "\u2728",
  };
  return map[iconName] ?? "\u25C6";
}

export const SkillHexNode = memo(SkillHexNodeInner);
export const nodeTypes = { "skill-hex": SkillHexNode };
