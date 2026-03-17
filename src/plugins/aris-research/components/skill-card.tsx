"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import type { ArisSkill } from "../types";

const TIER_LABELS: Record<number, { en: string; zh: string; variant: "default" | "secondary" | "outline" }> = {
  1: { en: "Basic", zh: "基础", variant: "outline" },
  2: { en: "Intermediate", zh: "中级", variant: "secondary" },
  3: { en: "Advanced", zh: "高级", variant: "default" },
};

interface SkillCardProps {
  skill: ArisSkill;
  locale: string;
  onLaunch: (skill: ArisSkill) => void;
}

export function SkillCard({ skill, locale, onLaunch }: SkillCardProps) {
  const isZh = locale === "zh-CN";
  const tier = TIER_LABELS[skill.tier] ?? TIER_LABELS[1];
  const paramCount = skill.params?.length ?? 0;

  return (
    <Card className="group hover:border-primary/40 transition-colors">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold truncate">
                {isZh ? skill.nameZh : skill.name}
              </h3>
              <Badge variant={tier.variant} className="text-[10px] px-1.5 py-0 shrink-0">
                {isZh ? tier.zh : tier.en}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {isZh ? skill.descriptionZh : skill.description}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between mt-auto pt-1">
          <div className="flex items-center gap-2">
            <code className="text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
              {skill.command}
            </code>
            {paramCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {paramCount} {isZh ? "参数" : paramCount === 1 ? "param" : "params"}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="default"
            className="h-7 px-3 text-xs gap-1"
            onClick={() => onLaunch(skill)}
          >
            <Play className="h-3 w-3" />
            {isZh ? "启动" : "Launch"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
