"use client";

import { useState, type DragEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, GripVertical, ChevronDown, ChevronRight } from "lucide-react";
import { SKILLS_BY_CATEGORY, CATEGORY_META } from "../skill-data";
import type { SkillCategory, ArisSkill } from "../types";

const CATEGORIES: SkillCategory[] = ["workflow", "research", "experiment", "paper", "utility"];

interface SkillPaletteProps {
  locale: string;
}

function DraggableSkillItem({ skill, isZh }: { skill: ArisSkill; isZh: boolean }) {
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
        variant={skill.tier === 3 ? "default" : skill.tier === 2 ? "secondary" : "outline"}
        className="text-[9px] px-1 py-0 shrink-0"
      >
        T{skill.tier}
      </Badge>
    </div>
  );
}

export function SkillPalette({ locale }: SkillPaletteProps) {
  const isZh = locale === "zh-CN";
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="w-[220px] border-r bg-background flex flex-col h-full">
      {/* Header */}
      <div className="p-2 border-b">
        <div className="text-xs font-semibold mb-2">
          {isZh ? "技能面板" : "Skill Palette"}
        </div>
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
      <div className="flex-1 overflow-y-auto p-1">
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
          const isOpen = !collapsed[cat];

          return (
            <div key={cat} className="mb-1">
              <button
                className="flex items-center gap-1 w-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => toggleCategory(cat)}
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {isZh ? meta.labelZh : meta.label}
                <span className="ml-auto text-[10px]">({skills.length})</span>
              </button>
              {isOpen && (
                <div className="space-y-0.5">
                  {skills.map((skill) => (
                    <DraggableSkillItem key={skill.id} skill={skill} isZh={isZh} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Drag hint */}
      <div className="p-2 border-t text-[10px] text-muted-foreground text-center">
        {isZh ? "拖拽技能到画布" : "Drag skills onto canvas"}
      </div>
    </div>
  );
}
