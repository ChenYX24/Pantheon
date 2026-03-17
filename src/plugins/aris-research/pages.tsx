"use client";

import { useState, useCallback, useEffect, lazy, Suspense, type SyntheticEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlaskConical, Workflow, Loader2, ArrowLeft } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import type { ArisSkill, ResearchState } from "./types";
import { ARIS_SKILLS } from "./skill-data";
import { getResearchState, getResearchStateSync } from "./aris-store";
import { ConfigPanel } from "./components/config-panel";
import { SkillLaunchDialog } from "./components/skill-launch-dialog";
import { StagePipeline } from "./components/stage-pipeline";
import { SessionsButton } from "./components/sessions-panel";
import { WorkspacesButton } from "./components/workspace-panel";

const PipelineCanvas = lazy(() =>
  import("./components/pipeline-canvas").then((m) => ({ default: m.PipelineCanvas }))
);

function PipelineLoading() {
  return (
    <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading pipeline editor...</span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-muted text-muted-foreground",
  running: "bg-green-500/20 text-green-700 dark:text-green-400",
  paused: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
  completed: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
  error: "bg-red-500/20 text-red-700 dark:text-red-400",
};

export function ArisResearchPage() {
  const t = useTranslations("aris");
  const locale = useLocale();
  const isZh = locale === "zh-CN";

  const [showCustomPipeline, setShowCustomPipeline] = useState(false);
  const [launchSkill, setLaunchSkill] = useState<ArisSkill | null>(null);
  const [launchContext, setLaunchContext] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Async research state
  const [state, setState] = useState<ResearchState>(getResearchStateSync);
  useEffect(() => {
    getResearchState().then(setState);
  }, []);

  const statusLabel = t(`status.${state.status}`);
  const statusColor = STATUS_COLORS[state.status] ?? STATUS_COLORS.idle;

  const handleLaunchById = useCallback((skillId: string, context?: string) => {
    const skill = ARIS_SKILLS.find((s) => s.id === skillId);
    if (skill) {
      setLaunchSkill(skill);
      setLaunchContext(context ?? "");
      setDialogOpen(true);
    }
  }, []);

  // Listen for skill launch events from sessions panel "Next Steps"
  useEffect(() => {
    const handler = (e: Event) => {
      const { skillId } = (e as CustomEvent).detail ?? {};
      if (skillId) handleLaunchById(skillId);
    };
    window.addEventListener("aris-launch-skill", handler);
    return () => window.removeEventListener("aris-launch-skill", handler);
  }, [handleLaunchById]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 pb-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`${statusColor} border-0`}>{statusLabel}</Badge>
          <Badge variant="outline" className="text-xs">
            {ARIS_SKILLS.length} {t("skillCount")}
          </Badge>
          <WorkspacesButton isZh={isZh} locale={locale} />
          <SessionsButton isZh={isZh} />
          <ConfigPanel />
          {showCustomPipeline ? (
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1.5"
              onClick={() => setShowCustomPipeline(false)}
            >
              <ArrowLeft className="h-3 w-3" />
              {isZh ? "返回流程" : "Back to Stages"}
            </Button>
          ) : (
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1.5"
              onClick={() => setShowCustomPipeline(true)}
            >
              <Workflow className="h-3 w-3" />
              {isZh ? "自由编排" : "Custom Pipeline"}
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 border rounded-lg overflow-hidden">
        {showCustomPipeline ? (
          <Suspense fallback={<PipelineLoading />}>
            <PipelineCanvas locale={locale} />
          </Suspense>
        ) : (
          <StagePipeline locale={locale} onLaunchSkill={handleLaunchById} />
        )}
      </div>

      {/* Skill Launch Dialog */}
      <SkillLaunchDialog
        skill={launchSkill}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locale={locale}
        stageContext={launchContext}
      />
    </div>
  );
}

export default ArisResearchPage;
