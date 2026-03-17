"use client";

import { lazy, Suspense } from "react";
import { Loader2, TreePine } from "lucide-react";
import { useLocale } from "next-intl";

const TreeCanvas = lazy(() =>
  import("./components/tree-canvas").then((m) => ({ default: m.TreeCanvas }))
);

function TreeLoading() {
  return (
    <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading skill tree...</span>
    </div>
  );
}

export function SkillTreePage() {
  const locale = useLocale();
  const isZh = locale === "zh-CN";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-1 pb-3">
        <TreePine className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">{isZh ? "技能树" : "Skill Tree"}</h1>
          <p className="text-sm text-muted-foreground">
            {isZh
              ? "全景能力图谱 — 查看、配置和规划你的 AI 工作站"
              : "Full capability map — view, configure and plan your AI workstation"}
          </p>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 border rounded-lg overflow-hidden">
        <Suspense fallback={<TreeLoading />}>
          <TreeCanvas locale={locale} />
        </Suspense>
      </div>
    </div>
  );
}

export default SkillTreePage;
