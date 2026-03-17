"use client";

import { useState, type DragEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search, GripVertical, ChevronDown, ChevronRight,
  Shield, Code2, TestTube, PenTool, Brain, Layers,
  Globe, Eye, Wrench, MessageSquare,
} from "lucide-react";

/** Template for quickly adding a member node */
interface MemberTemplate {
  id: string;
  name: string;
  nameZh: string;
  role: string;
  roleZh: string;
  provider: string;
  model: string;
  icon: React.ReactNode;
  category: "roles" | "models" | "utilities";
}

const MEMBER_TEMPLATES: MemberTemplate[] = [
  // Roles
  {
    id: "tpl-architect",
    name: "Architect",
    nameZh: "架构师",
    role: "System Architect",
    roleZh: "系统架构师",
    provider: "claude",
    model: "claude-opus-4-6",
    icon: <Shield className="h-3.5 w-3.5" />,
    category: "roles",
  },
  {
    id: "tpl-developer",
    name: "Developer",
    nameZh: "开发者",
    role: "Developer",
    roleZh: "开发工程师",
    provider: "claude",
    model: "claude-sonnet-4-5",
    icon: <Code2 className="h-3.5 w-3.5" />,
    category: "roles",
  },
  {
    id: "tpl-reviewer",
    name: "Reviewer",
    nameZh: "审查员",
    role: "Code Reviewer",
    roleZh: "代码审查员",
    provider: "claude",
    model: "claude-sonnet-4-5",
    icon: <Eye className="h-3.5 w-3.5" />,
    category: "roles",
  },
  {
    id: "tpl-tester",
    name: "Tester",
    nameZh: "测试员",
    role: "QA Tester",
    roleZh: "质量测试员",
    provider: "claude",
    model: "claude-haiku-3-5",
    icon: <TestTube className="h-3.5 w-3.5" />,
    category: "roles",
  },
  {
    id: "tpl-writer",
    name: "Writer",
    nameZh: "文档员",
    role: "Technical Writer",
    roleZh: "技术文档",
    provider: "claude",
    model: "claude-haiku-3-5",
    icon: <PenTool className="h-3.5 w-3.5" />,
    category: "roles",
  },
  {
    id: "tpl-researcher",
    name: "Researcher",
    nameZh: "研究员",
    role: "Researcher",
    roleZh: "研究分析",
    provider: "claude",
    model: "claude-opus-4-6",
    icon: <Search className="h-3.5 w-3.5" />,
    category: "roles",
  },
  // Models
  {
    id: "tpl-claude-opus",
    name: "Claude Opus",
    nameZh: "Claude Opus",
    role: "General Agent",
    roleZh: "通用智能体",
    provider: "claude",
    model: "claude-opus-4-6",
    icon: <Brain className="h-3.5 w-3.5" />,
    category: "models",
  },
  {
    id: "tpl-claude-sonnet",
    name: "Claude Sonnet",
    nameZh: "Claude Sonnet",
    role: "General Agent",
    roleZh: "通用智能体",
    provider: "claude",
    model: "claude-sonnet-4-5",
    icon: <Brain className="h-3.5 w-3.5" />,
    category: "models",
  },
  {
    id: "tpl-codex",
    name: "Codex Agent",
    nameZh: "Codex 智能体",
    role: "Code Agent",
    roleZh: "代码智能体",
    provider: "codex",
    model: "codex-mini",
    icon: <Layers className="h-3.5 w-3.5" />,
    category: "models",
  },
  {
    id: "tpl-api-agent",
    name: "API Agent",
    nameZh: "API 智能体",
    role: "Custom Agent",
    roleZh: "自定义智能体",
    provider: "api",
    model: "gpt-4o",
    icon: <Globe className="h-3.5 w-3.5" />,
    category: "models",
  },
  // Utilities
  {
    id: "tpl-decision",
    name: "Decision Gate",
    nameZh: "决策节点",
    role: "decision",
    roleZh: "决策",
    provider: "none",
    model: "none",
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    category: "utilities",
  },
  {
    id: "tpl-aggregator",
    name: "Aggregator",
    nameZh: "合并节点",
    role: "aggregator",
    roleZh: "合并",
    provider: "none",
    model: "none",
    icon: <Wrench className="h-3.5 w-3.5" />,
    category: "utilities",
  },
];

const CATEGORY_META: Record<string, { label: string; labelZh: string }> = {
  roles: { label: "Role Templates", labelZh: "角色模板" },
  models: { label: "Model Agents", labelZh: "模型智能体" },
  utilities: { label: "Utilities", labelZh: "工具节点" },
};

const CATEGORIES = ["roles", "models", "utilities"] as const;

const PROVIDER_COLORS: Record<string, string> = {
  claude: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  codex: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  api: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  none: "bg-muted text-muted-foreground",
};

function DraggableTemplateItem({ tpl, isZh }: { tpl: MemberTemplate; isZh: boolean }) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData("application/agent-team-template", JSON.stringify(tpl));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing hover:bg-accent transition-colors group"
    >
      <GripVertical className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground flex-shrink-0" />
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-muted-foreground flex-shrink-0">{tpl.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">
            {isZh ? tpl.nameZh : tpl.name}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {isZh ? tpl.roleZh : tpl.role}
          </div>
        </div>
      </div>
      {tpl.provider !== "none" && (
        <Badge
          variant="secondary"
          className={`text-[9px] px-1 py-0 shrink-0 ${PROVIDER_COLORS[tpl.provider] ?? ""}`}
        >
          {tpl.provider}
        </Badge>
      )}
    </div>
  );
}

interface MemberPaletteProps {
  locale: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function MemberPalette({ locale, collapsed, onToggle }: MemberPaletteProps) {
  const isZh = locale === "zh-CN";
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});

  const toggleCategory = (cat: string) => {
    setCollapsedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  if (collapsed) {
    return (
      <div className="w-10 border-r bg-background flex flex-col items-center py-3">
        <button
          onClick={onToggle}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          title={isZh ? "展开面板" : "Expand palette"}
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[220px] border-r bg-background flex flex-col h-full">
      {/* Header */}
      <div className="p-2 border-b">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold">
            {isZh ? "成员面板" : "Member Palette"}
          </span>
          {onToggle && (
            <button
              onClick={onToggle}
              className="p-0.5 rounded hover:bg-accent transition-colors"
            >
              <ChevronDown className="h-3 w-3 text-muted-foreground rotate-90" />
            </button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            className="h-7 text-xs pl-7"
            placeholder={isZh ? "搜索模板..." : "Search templates..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto p-1">
        {CATEGORIES.map((cat) => {
          const meta = CATEGORY_META[cat];
          const templates = MEMBER_TEMPLATES.filter((t) => {
            if (t.category !== cat) return false;
            if (!search) return true;
            const q = search.toLowerCase();
            return (
              t.name.toLowerCase().includes(q) ||
              t.nameZh.includes(q) ||
              t.role.toLowerCase().includes(q)
            );
          });

          if (templates.length === 0) return null;
          const isOpen = !collapsedCats[cat];

          return (
            <div key={cat} className="mb-1">
              <button
                className="flex items-center gap-1 w-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => toggleCategory(cat)}
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {isZh ? meta.labelZh : meta.label}
                <span className="ml-auto text-[10px]">({templates.length})</span>
              </button>
              {isOpen && (
                <div className="space-y-0.5">
                  {templates.map((tpl) => (
                    <DraggableTemplateItem key={tpl.id} tpl={tpl} isZh={isZh} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Drag hint */}
      <div className="p-2 border-t text-[10px] text-muted-foreground text-center">
        {isZh ? "拖拽到画布添加成员" : "Drag onto canvas to add"}
      </div>
    </div>
  );
}
