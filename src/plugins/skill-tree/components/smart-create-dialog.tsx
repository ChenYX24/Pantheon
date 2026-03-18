"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Wand2,
  Loader2,
  CheckCircle,
  Plus,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  Package,
} from "lucide-react";
import type { SkillTreeNode, CustomSkill } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillProposal {
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  category: string;
  tier: number;
  implType: string;
  tags: string[];
  icon: string;
  dependencies?: string[];
  setupSteps?: string[];
  setupStepsZh?: string[];
}

interface SmartCreateResult {
  mainSkill: SkillProposal;
  newDependencies: SkillProposal[];
  existingDependencies: string[];
  reasoning: string;
}

type Phase = "input" | "generating" | "preview" | "error";

// ---------------------------------------------------------------------------
// SSE text accumulator — extracts text from Claude stream-json events
// ---------------------------------------------------------------------------

function extractTextFromSSE(line: string): string {
  if (!line.startsWith("data: ")) return "";
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return "";
  try {
    const evt = JSON.parse(payload);
    if (evt.type === "assistant" && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === "text") return block.text ?? "";
      }
    }
    if (evt.type === "content_block_delta" && evt.delta?.text) {
      return evt.delta.text;
    }
    if (evt.type === "result" && evt.result) {
      return typeof evt.result === "string" ? evt.result : "";
    }
    if (evt.type === "error") return "";
  } catch {
    // not JSON
  }
  return "";
}

function tryParseJSON(raw: string): SmartCreateResult | null {
  // Find JSON object in the accumulated text
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (parsed.mainSkill && typeof parsed.mainSkill.name === "string") {
      return parsed as SmartCreateResult;
    }
  } catch {
    // invalid JSON
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SkillPreviewCard({
  skill,
  isMain,
  isZh,
  t,
}: {
  skill: SkillProposal;
  isMain: boolean;
  isZh: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const name = isZh ? skill.nameZh : skill.name;
  const desc = isZh ? skill.descriptionZh : skill.description;

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
        isMain
          ? "border-violet-500/30 bg-violet-500/5"
          : "border-sky-500/20 bg-sky-500/5"
      }`}
    >
      <div className="flex items-center gap-2">
        {isMain ? (
          <Sparkles className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        ) : (
          <Package className="h-3.5 w-3.5 text-sky-400 shrink-0" />
        )}
        <span className="text-xs font-semibold">{name}</span>
        <Badge
          variant="outline"
          className={`text-[8px] px-1 py-0 ${
            isMain
              ? "border-violet-500/30 text-violet-400"
              : "border-sky-500/30 text-sky-400"
          }`}
        >
          {isMain ? t("smart.mainSkill") : t("smart.dependency")}
        </Badge>
        <Badge variant="outline" className="text-[8px] px-1 py-0">
          T{skill.tier}
        </Badge>
        <Badge variant="outline" className="text-[8px] px-1 py-0">
          {skill.category}
        </Badge>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map((tag) => (
            <span
              key={tag}
              className="text-[8px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
      {skill.setupSteps && skill.setupSteps.length > 0 && (
        <div className="text-[9px] text-muted-foreground border-t border-border/50 pt-1.5 mt-1">
          {(isZh && skill.setupStepsZh ? skill.setupStepsZh : skill.setupSteps).map(
            (step, i) => (
              <div key={i} className="flex gap-1.5">
                <span className="text-amber-400 shrink-0">{i + 1}.</span>
                <span>{step}</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ExistingDepBadge({
  skillId,
  allSkills,
  isZh,
}: {
  skillId: string;
  allSkills: SkillTreeNode[];
  isZh: boolean;
}) {
  const skill = allSkills.find((s) => s.id === skillId);
  return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1">
      <CheckCircle className="h-2.5 w-2.5 text-emerald-400" />
      {skill ? (isZh ? skill.nameZh : skill.name) : skillId}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main Dialog
// ---------------------------------------------------------------------------

interface SmartCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allSkills: SkillTreeNode[];
  isZh: boolean;
  onConfirm: (skills: Omit<CustomSkill, "isCustom" | "createdAt">[]) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function SmartCreateDialog({
  open,
  onOpenChange,
  allSkills,
  isZh,
  onConfirm,
  t,
}: SmartCreateDialogProps) {
  const [phase, setPhase] = useState<Phase>("input");
  const [description, setDescription] = useState("");
  const [streamText, setStreamText] = useState("");
  const [result, setResult] = useState<SmartCreateResult | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setPhase("input");
      setDescription("");
      setStreamText("");
      setResult(null);
      setError("");
      setConfirming(false);
    }
  }, [open]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setPhase("generating");
    setStreamText("");
    setResult(null);
    setError("");

    const existingSkillNames = allSkills.map(
      (s) => `${s.id}: ${s.name} (${s.nameZh}) - ${s.description}`
    );

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/plugins/skill-tree/smart-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          existingSkills: existingSkillNames,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError(t("smart.networkError"));
        setPhase("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          const text = extractTextFromSSE(line);
          if (text) {
            accumulated += text;
            setStreamText(accumulated);
          }
        }
      }

      // Try to parse the accumulated text
      const parsed = tryParseJSON(accumulated);
      if (parsed) {
        setResult(parsed);
        setPhase("preview");
      } else {
        setError(t("smart.parseError"));
        setPhase("error");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || t("smart.networkError"));
      setPhase("error");
    }
  }, [description, allSkills, t]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase("input");
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!result) return;
    setConfirming(true);

    const skillsToCreate: Omit<CustomSkill, "isCustom" | "createdAt">[] = [];

    // Create dependency skills first
    for (const dep of result.newDependencies) {
      skillsToCreate.push({
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: dep.name,
        nameZh: dep.nameZh || dep.name,
        description: dep.description,
        descriptionZh: dep.descriptionZh || dep.description,
        category: dep.category as SkillTreeNode["category"],
        defaultStatus: "configurable",
        icon: dep.icon || "Package",
        implType: dep.implType as SkillTreeNode["implType"],
        dependencies: [],
        tier: dep.tier || 1,
        tags: dep.tags || [],
      });
    }

    // Create main skill with dependencies pointing to new + existing skills
    const depIds = [
      ...result.existingDependencies,
      ...skillsToCreate.map((s) => s.id),
    ];

    const main = result.mainSkill;
    skillsToCreate.push({
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: main.name,
      nameZh: main.nameZh || main.name,
      description: main.description,
      descriptionZh: main.descriptionZh || main.description,
      category: main.category as SkillTreeNode["category"],
      defaultStatus: "configurable",
      icon: main.icon || "Sparkles",
      implType: main.implType as SkillTreeNode["implType"],
      dependencies: depIds,
      tier: main.tier || 2,
      tags: main.tags || [],
      setupSteps: isZh
        ? main.setupStepsZh || main.setupSteps
        : main.setupSteps,
    });

    await onConfirm(skillsToCreate);
    setConfirming(false);
    onOpenChange(false);
  }, [result, isZh, onConfirm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-400" />
            {t("smart.title")}
          </DialogTitle>
          <DialogDescription>{t("smart.description")}</DialogDescription>
        </DialogHeader>

        {/* Phase: Input */}
        {phase === "input" && (
          <div className="space-y-3 py-2">
            <Textarea
              className="min-h-[80px] text-sm resize-none"
              placeholder={t("smart.placeholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: isZh ? "炒股分析" : "Stock Trading", value: "stock trading and market analysis" },
                { label: isZh ? "视频剪辑" : "Video Editing", value: "video editing and post-production" },
                { label: isZh ? "数据可视化" : "Data Viz", value: "data visualization and charting" },
                { label: isZh ? "DevOps 部署" : "DevOps Deploy", value: "DevOps deployment and CI/CD" },
              ].map((example) => (
                <button
                  key={example.value}
                  className="text-[10px] px-2 py-1 rounded-full border border-border/50 text-muted-foreground hover:text-foreground hover:border-violet-500/30 transition-colors"
                  onClick={() => setDescription(example.value)}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Phase: Generating */}
        {phase === "generating" && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              <span>{t("smart.analyzing")}</span>
            </div>
            {streamText && (
              <div className="bg-muted/50 rounded-lg p-3 max-h-[200px] overflow-y-auto">
                <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
                  {streamText.length > 500
                    ? "..." + streamText.slice(-500)
                    : streamText}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Phase: Preview */}
        {phase === "preview" && result && (
          <div className="space-y-4 py-2">
            {/* Reasoning */}
            <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">{t("smart.reasoning")}</span>{" "}
              {result.reasoning}
            </div>

            {/* Existing dependencies reused */}
            {result.existingDependencies.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                  <CheckCircle className="h-3 w-3" />
                  {t("smart.reusedSkills")}
                </div>
                <div className="flex flex-wrap gap-1">
                  {result.existingDependencies.map((id) => (
                    <ExistingDepBadge
                      key={id}
                      skillId={id}
                      allSkills={allSkills}
                      isZh={isZh}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* New dependencies to create */}
            {result.newDependencies.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-400">
                  <Plus className="h-3 w-3" />
                  {t("smart.newDeps")}
                </div>
                {result.newDependencies.map((dep, i) => (
                  <SkillPreviewCard
                    key={i}
                    skill={dep}
                    isMain={false}
                    isZh={isZh}
                    t={t}
                  />
                ))}
              </div>
            )}

            {/* Arrow */}
            <div className="flex justify-center">
              <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
            </div>

            {/* Main skill */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-400">
                <Sparkles className="h-3 w-3" />
                {t("smart.mainSkillLabel")}
              </div>
              <SkillPreviewCard
                skill={result.mainSkill}
                isMain={true}
                isZh={isZh}
                t={t}
              />
            </div>

            {/* Summary */}
            <div className="text-[10px] text-muted-foreground text-center">
              {t("smart.summary", {
              total: 1 + result.newDependencies.length,
              reused: result.existingDependencies.length,
            })}
            </div>
          </div>
        )}

        {/* Phase: Error */}
        {phase === "error" && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          {phase === "input" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("smart.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!description.trim()}
                onClick={handleGenerate}
                className="gap-1.5 bg-violet-600 hover:bg-violet-700"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {t("smart.generate")}
              </Button>
            </>
          )}

          {phase === "generating" && (
            <Button variant="outline" size="sm" onClick={handleCancel}>
              {t("smart.cancel")}
            </Button>
          )}

          {phase === "preview" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPhase("input")}
              >
                {t("smart.back")}
              </Button>
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={confirming}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              >
                {confirming ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="h-3.5 w-3.5" />
                )}
                {t("smart.confirmAdd")}
              </Button>
            </>
          )}

          {phase === "error" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("smart.cancel")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPhase("input")}
              >
                {t("smart.retry")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
