"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  BookOpen,
  ShieldCheck,
  Cpu,
  Zap,
  RefreshCw,
  FileText,
  Play,
  Lightbulb,
  LinkIcon,
  Upload,
  X,
  CheckCircle2,
  Circle,
  Sparkles,
  Edit3,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ImageIcon,
} from "lucide-react";
import { ARIS_SKILLS } from "../skill-data";
import {
  RESEARCH_STAGES,
  STAGE_COLORS,
  type ResearchStage,
  type StageStatus,
} from "../research-stages";
import type { ProgramAttachment } from "../types";

/* ─── Icon Map ─── */
const STAGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BookOpen, ShieldCheck, Cpu, Zap, RefreshCw, FileText,
};

/* ─── Per-stage runtime data ─── */
interface StageData {
  status: StageStatus;
  inputs: Record<string, string>;
  attachments: ProgramAttachment[];
  notes: string;
}

function generateId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ─────────────────────────────────────────────
   Stage Card (collapsed / overview)
   ───────────────────────────────────────────── */
function StageCard({
  stage,
  data,
  isActive,
  onClick,
  isZh,
}: {
  stage: ResearchStage;
  data: StageData;
  isActive: boolean;
  onClick: () => void;
  isZh: boolean;
}) {
  const colors = STAGE_COLORS[stage.color];
  const Icon = STAGE_ICONS[stage.icon] ?? FileText;
  const filledInputs = Object.values(data.inputs).filter(Boolean).length;
  const totalInputs = stage.inputs.filter((i) => i.required).length;

  return (
    <Card
      className={`
        cursor-pointer transition-all duration-200 group h-full
        ${isActive
          ? `${colors.border} border-2 shadow-md`
          : "hover:shadow-md hover:border-primary/20"
        }
      `}
      onClick={onClick}
    >
      <CardContent className="p-4 flex flex-col h-full">
        {/* Top: Icon + Number */}
        <div className="flex items-start justify-between mb-3">
          <div className={`rounded-xl p-2.5 ${colors.bg}`}>
            <Icon className={`h-5 w-5 ${colors.text}`} />
          </div>
          <div className="flex items-center gap-1.5">
            {data.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            {data.status === "in-progress" && <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />}
            {(data.status === "available" || data.status === "locked") && (
              <Circle className={`h-4 w-4 ${data.status === "locked" ? "text-muted-foreground/20" : "text-muted-foreground/50"}`} />
            )}
            <span className={`text-2xl font-bold ${colors.text} opacity-30`}>
              {stage.number}
            </span>
          </div>
        </div>

        {/* Name */}
        <h3 className="text-sm font-semibold mb-1">
          {isZh ? stage.nameZh : stage.name}
        </h3>

        {/* Goal — fixed 2-line height */}
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3 flex-1">
          {isZh ? stage.goalZh : stage.goal}
        </p>

        {/* Bottom: Skills count + Progress — always at bottom */}
        <div className="flex items-center justify-between mt-auto pt-1">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {stage.skills.length} {isZh ? "技能" : "skills"}
          </Badge>
          {totalInputs > 0 && (
            <span className={`text-[10px] ${filledInputs >= totalInputs ? "text-green-600" : "text-muted-foreground"}`}>
              {filledInputs}/{totalInputs}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────
   Stage Detail Panel (expanded)
   ───────────────────────────────────────────── */
function StageDetail({
  stage,
  data,
  onDataChange,
  onClose,
  isZh,
  onLaunchSkill,
}: {
  stage: ResearchStage;
  data: StageData;
  onDataChange: (patch: Partial<StageData>) => void;
  onClose: () => void;
  isZh: boolean;
  onLaunchSkill: (skillId: string, context?: string) => void;
}) {
  const colors = STAGE_COLORS[stage.color];
  const Icon = STAGE_ICONS[stage.icon] ?? FileText;
  const [showTips, setShowTips] = useState(false);
  const [linkInput, setLinkInput] = useState("");

  const addAttachment = (att: ProgramAttachment) => {
    onDataChange({ attachments: [...data.attachments, att] });
  };
  const removeAttachment = (id: string) => {
    onDataChange({ attachments: data.attachments.filter((a) => a.id !== id) });
  };
  const handleAddLink = () => {
    const url = linkInput.trim();
    if (!url) return;
    addAttachment({
      id: generateId(), name: url.replace(/^https?:\/\//, "").slice(0, 50),
      type: "link", url, addedAt: new Date().toISOString(),
    });
    setLinkInput("");
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header Card */}
      <Card className={`${colors.border} border ${colors.bg}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-xl p-3 bg-background/80 shadow-sm`}>
                <Icon className={`h-6 w-6 ${colors.text}`} />
              </div>
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span className={`${colors.text} text-sm font-mono`}>0{stage.number}</span>
                  {isZh ? stage.nameZh : stage.name}
                </h2>
                <p className={`text-sm ${colors.text} mt-0.5`}>
                  {isZh ? stage.goalZh : stage.goal}
                </p>
              </div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            {isZh ? stage.descriptionZh : stage.description}
          </p>
        </CardHeader>
      </Card>

      {/* Three column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Col 1: Skills */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              {isZh ? "可用技能" : "Available Skills"}
            </h3>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {/* Workflow skills first — prominent */}
            {stage.skills.filter((r) => r.isWorkflow).map((ref) => {
              const skill = ARIS_SKILLS.find((s) => s.id === ref.skillId);
              if (!skill) return null;
              return (
                <button
                  key={ref.skillId}
                  className="flex items-center gap-3 w-full p-3 rounded-lg border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
                  onClick={() => onLaunchSkill(ref.skillId, buildStageContext(stage, data, isZh))}
                >
                  <div className="rounded-lg p-1.5 bg-primary/10">
                    <Zap className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold">{isZh ? skill.nameZh : skill.name}</span>
                      <Badge className="text-[9px] px-1.5 py-0 bg-primary/20 text-primary border-0">
                        {isZh ? "一键运行" : "One-click"}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {isZh ? ref.roleZh : ref.role}
                    </p>
                  </div>
                  <Play className="h-4 w-4 text-primary shrink-0" />
                </button>
              );
            })}

            {/* Separator if we have both workflow and regular skills */}
            {stage.skills.some((r) => r.isWorkflow) && stage.skills.some((r) => !r.isWorkflow) && (
              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 border-t" />
                <span className="text-[10px] text-muted-foreground">{isZh ? "或单独运行" : "or run individually"}</span>
                <div className="flex-1 border-t" />
              </div>
            )}

            {/* Regular skills */}
            {stage.skills.filter((r) => !r.isWorkflow).map((ref) => {
              const skill = ARIS_SKILLS.find((s) => s.id === ref.skillId);
              if (!skill) return null;
              return (
                <div
                  key={ref.skillId}
                  className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{isZh ? skill.nameZh : skill.name}</span>
                      {ref.optional && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{isZh ? "可选" : "opt"}</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                      {isZh ? ref.roleZh : ref.role}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onLaunchSkill(ref.skillId, buildStageContext(stage, data, isZh))}
                  >
                    <Play className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                </div>
              );
            })}

            {/* Outputs */}
            <div className="pt-2 mt-2 border-t">
              <span className="text-[11px] font-medium text-muted-foreground">
                {isZh ? "产出文件" : "Outputs"}
              </span>
              <div className="space-y-1 mt-1.5">
                {stage.outputs.map((out) => (
                  <div key={out.file} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="font-mono truncate">{out.file}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Col 2: Your Inputs */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Edit3 className="h-4 w-4 text-muted-foreground" />
              {isZh ? "你的输入" : "Your Inputs"}
            </h3>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {stage.inputs.map((inp) => (
              <div key={inp.name} className="space-y-1">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-medium">{isZh ? inp.nameZh : inp.name}</span>
                  {inp.required && <span className="text-red-500 text-[10px]">*</span>}
                </div>
                {inp.type === "text" ? (
                  <textarea
                    className="flex w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[32px]"
                    value={data.inputs[inp.name] ?? ""}
                    onChange={(e) => onDataChange({ inputs: { ...data.inputs, [inp.name]: e.target.value } })}
                    placeholder={inp.placeholder || (isZh ? inp.descriptionZh : inp.description)}
                    rows={2}
                  />
                ) : inp.type === "link" ? (
                  <Input
                    className="h-7 text-xs"
                    placeholder={inp.placeholder || "https://..."}
                    value={data.inputs[inp.name] ?? ""}
                    onChange={(e) => onDataChange({ inputs: { ...data.inputs, [inp.name]: e.target.value } })}
                  />
                ) : (
                  <div
                    className="border border-dashed rounded-md p-2 text-center cursor-pointer hover:bg-accent/30 transition-colors"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      for (const file of Array.from(e.dataTransfer.files)) {
                        addAttachment({
                          id: generateId(), name: file.name,
                          type: file.type.startsWith("image/") ? "image" : "file",
                          url: URL.createObjectURL(file), mimeType: file.type,
                          addedAt: new Date().toISOString(),
                        });
                      }
                    }}
                  >
                    <Upload className="h-3 w-3 mx-auto text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground mt-0.5">{isZh ? "拖拽上传" : "Drop file"}</p>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Col 3: Context & Notes */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4 text-muted-foreground" />
              {isZh ? "上下文 & 笔记" : "Context & Notes"}
            </h3>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {/* Links */}
            <div>
              <span className="text-[11px] font-medium text-muted-foreground">
                {isZh ? "参考链接" : "Reference Links"}
              </span>
              <div className="flex gap-1.5 mt-1">
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="https://arxiv.org/abs/..."
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
                />
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={handleAddLink}>+</Button>
              </div>
            </div>

            {/* Attachments */}
            {data.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.attachments.map((att) => (
                  <Badge key={att.id} variant="secondary" className="text-[10px] px-1.5 py-0.5 gap-1 max-w-full">
                    {att.type === "link" ? <ExternalLink className="h-2.5 w-2.5 shrink-0" /> :
                     att.type === "image" ? <ImageIcon className="h-2.5 w-2.5 shrink-0" /> :
                     <FileText className="h-2.5 w-2.5 shrink-0" />}
                    <span className="truncate">{att.name}</span>
                    <button onClick={() => removeAttachment(att.id)} className="hover:text-red-500 shrink-0">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Notes */}
            <div>
              <span className="text-[11px] font-medium text-muted-foreground">
                {isZh ? "你的思考" : "Your Thoughts"}
              </span>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[100px] mt-1"
                value={data.notes}
                onChange={(e) => onDataChange({ notes: e.target.value })}
                placeholder={isZh
                  ? "自由记录...\n为什么选这个方向？有什么约束？之前尝试过什么？"
                  : "Free notes...\nWhy this direction? Constraints? Prior attempts?"}
                rows={5}
              />
            </div>

            {/* Tips */}
            <button
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
              onClick={() => setShowTips((v) => !v)}
            >
              <Lightbulb className="h-3 w-3" />
              {isZh ? "实用提示" : "Pro Tips"}
              {showTips ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {showTips && (
              <div className="space-y-1.5 pl-1">
                {(isZh ? stage.tipsZh : stage.tips).map((tip, i) => (
                  <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">
                    <span className="text-amber-500 mr-1">*</span>{tip}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main: Stage Pipeline
   ───────────────────────────────────────────── */
/** Build context string from stage data */
function buildStageContext(stage: ResearchStage, data: StageData, isZh: boolean): string {
  const parts: string[] = [];

  // Inputs
  for (const inp of stage.inputs) {
    const val = data.inputs[inp.name];
    if (val) {
      parts.push(`${isZh ? inp.nameZh : inp.name}: ${val}`);
    }
  }

  // Notes
  if (data.notes) {
    parts.push(`${isZh ? "补充说明" : "Notes"}: ${data.notes}`);
  }

  // Attachments (links)
  const links = data.attachments.filter((a) => a.type === "link");
  if (links.length > 0) {
    parts.push(`${isZh ? "参考链接" : "References"}: ${links.map((l) => l.url).join(", ")}`);
  }

  // Attachments (files)
  const files = data.attachments.filter((a) => a.type === "file");
  if (files.length > 0) {
    parts.push(`${isZh ? "附件" : "Files"}: ${files.map((f) => f.name).join(", ")}`);
  }

  return parts.join("\n");
}

interface StagePipelineProps {
  locale: string;
  onLaunchSkill: (skillId: string, context?: string) => void;
}

export function StagePipeline({ locale, onLaunchSkill }: StagePipelineProps) {
  const isZh = locale === "zh-CN";
  const [activeStage, setActiveStage] = useState<string | null>(null);

  const [stageData, setStageData] = useState<Record<string, StageData>>(() => {
    const init: Record<string, StageData> = {};
    for (const stage of RESEARCH_STAGES) {
      init[stage.id] = { status: "available", inputs: {}, attachments: [], notes: "" };
    }
    return init;
  });

  const updateStageData = useCallback(
    (stageId: string, patch: Partial<StageData>) => {
      setStageData((prev) => ({ ...prev, [stageId]: { ...prev[stageId], ...patch } }));
    },
    []
  );

  const activeStageObj = RESEARCH_STAGES.find((s) => s.id === activeStage);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Overview header + full pipeline button */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {isZh ? "科研全流程 — 点击任一阶段展开详情" : "Full Research Pipeline — click a stage to expand"}
            </h2>
            <button
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-xs font-semibold text-primary"
              onClick={() => {
                // Gather context from all stages
                const allContext = RESEARCH_STAGES
                  .map((s) => buildStageContext(s, stageData[s.id], isZh))
                  .filter(Boolean)
                  .join("\n---\n");
                onLaunchSkill("research-pipeline", allContext);
              }}
            >
              <Zap className="h-3.5 w-3.5" />
              {isZh ? "一键启动全流程" : "Run Full Pipeline"}
            </button>
          </div>

          {/* Stage cards with arrows between rows */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {RESEARCH_STAGES.map((stage, i) => (
              <div key={stage.id} className="relative">
                <StageCard
                  stage={stage}
                  data={stageData[stage.id]}
                  isActive={activeStage === stage.id}
                  onClick={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
                  isZh={isZh}
                />
                {/* Arrow connector (hidden on last item per row) */}
                {i < RESEARCH_STAGES.length - 1 && (
                  <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                    <div className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Expanded stage detail */}
        {activeStageObj && (
          <StageDetail
            stage={activeStageObj}
            data={stageData[activeStageObj.id]}
            onDataChange={(patch) => updateStageData(activeStageObj.id, patch)}
            onClose={() => setActiveStage(null)}
            isZh={isZh}
            onLaunchSkill={onLaunchSkill}
          />
        )}
      </div>
    </div>
  );
}
