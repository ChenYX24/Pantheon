"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, RefreshCw, FileText, Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
import { QUICK_LAUNCH_SKILLS } from "../skill-data";
import type { ArisSkill } from "../types";

const ICONS = [Lightbulb, RefreshCw, FileText];
const COLORS = [
  "border-amber-500/30 bg-amber-500/5",
  "border-blue-500/30 bg-blue-500/5",
  "border-green-500/30 bg-green-500/5",
];

interface QuickLaunchProps {
  locale: string;
  onLaunch: (skill: ArisSkill) => void;
}

export function QuickLaunch({ locale, onLaunch }: QuickLaunchProps) {
  const t = useTranslations("aris");
  const isZh = locale === "zh-CN";

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">{t("quickLaunch.title")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {QUICK_LAUNCH_SKILLS.map((skill, i) => {
          const Icon = ICONS[i];
          const paramCount = skill.params?.length ?? 0;
          return (
            <Card key={skill.id} className={`transition-colors ${COLORS[i]}`}>
              <CardContent className="p-4 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5" />
                  <span className="font-semibold text-sm">
                    {isZh ? skill.nameZh : skill.name}
                  </span>
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 ml-auto">
                    T3
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {isZh ? skill.descriptionZh : skill.description}
                </p>

                {/* Param hints */}
                {paramCount > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {skill.params!.map((p) => (
                      <span
                        key={p.name}
                        className="text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground"
                      >
                        {p.name}
                        {p.required && <span className="text-red-500 ml-0.5">*</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Launch button */}
                <Button
                  size="sm"
                  variant="default"
                  className="w-full h-8 text-xs gap-1.5"
                  onClick={() => onLaunch(skill)}
                >
                  <Rocket className="h-3.5 w-3.5" />
                  {isZh ? "配置并启动" : "Configure & Launch"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
