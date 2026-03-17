"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type DragEvent,
} from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  FlaskConical,
  FileText,
  Search,
  Plus,
  Upload,
  LinkIcon,
  X,
  ArrowRight,
  ArrowLeft,
  Clock,
  Copy,
  Pencil,
  Trash2,
  Play,
  Inbox,
} from "lucide-react";
import type { Pipeline, PipelineWithState, ResearchProgram, ProgramAttachment, SkillCategory } from "../types";
import { PIPELINE_TEMPLATES } from "../pipeline-templates";
import { getPipelines, deletePipeline } from "../pipeline-store";
import { ARIS_SKILLS } from "../skill-data";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SetupWizardProps {
  isZh: boolean;
  onStartDesign: (config: {
    name: string;
    program: ResearchProgram;
    templateId: string | null;
  }) => void;
  onLoadPipeline: (pipelineId: string) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const ACCEPT_FILE_TYPES = ".jsonl,.pdf,.csv,.py,.json,.txt,.md,.bib,.tex,.yaml,.yml";

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  "tpl-idea-discovery": <Lightbulb className="h-5 w-5" />,
  "tpl-research-pipeline": <FlaskConical className="h-5 w-5" />,
  "tpl-paper-writing": <FileText className="h-5 w-5" />,
  "tpl-auto-review": <Search className="h-5 w-5" />,
};

/** Category -> color for mini DAG dots */
const CATEGORY_DOT_COLORS: Record<SkillCategory, string> = {
  workflow: "#8b5cf6",
  research: "#3b82f6",
  experiment: "#f59e0b",
  paper: "#10b981",
  utility: "#6b7280",
};

/** Estimate pipeline time based on node count */
function estimateTime(nodeCount: number): string {
  if (nodeCount <= 3) return "~10 min";
  if (nodeCount <= 6) return "~30 min";
  if (nodeCount <= 10) return "~1 hr";
  return "~2+ hr";
}

function estimateTimeZh(nodeCount: number): string {
  if (nodeCount <= 3) return "~10 分钟";
  if (nodeCount <= 6) return "~30 分钟";
  if (nodeCount <= 10) return "~1 小时";
  return "~2+ 小时";
}

/** Truncate text to a max length */
function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max) + "...";
}

// ---------------------------------------------------------------------------
// Mini DAG Preview (SVG)
// ---------------------------------------------------------------------------

interface MiniDagProps {
  nodes: Pipeline["nodes"];
  edges: Pipeline["edges"];
}

function MiniDag({ nodes, edges }: MiniDagProps) {
  const width = 160;
  const height = 60;
  const r = 5;

  // Build adjacency to compute simple topological layers
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    adj.get(e.source)?.push(e.target);
  }

  // BFS layering
  const layers: string[][] = [];
  const visited = new Set<string>();
  let queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length > 0) {
    layers.push(queue);
    for (const id of queue) visited.add(id);
    const next: string[] = [];
    for (const id of queue) {
      for (const t of adj.get(id) ?? []) {
        if (!visited.has(t) && !next.includes(t)) {
          next.push(t);
        }
      }
    }
    queue = next;
    if (layers.length > 20) break; // safety
  }
  // Add any unvisited nodes
  const unvisited = nodes.filter((n) => !visited.has(n.id));
  if (unvisited.length > 0) {
    layers.push(unvisited.map((n) => n.id));
  }

  // Compute positions
  const positions = new Map<string, { x: number; y: number }>();
  const layerCount = layers.length;
  const padX = 14;
  const padY = 12;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;

  for (let li = 0; li < layerCount; li++) {
    const layer = layers[li];
    const x = layerCount === 1 ? width / 2 : padX + (usableW * li) / (layerCount - 1);
    for (let ni = 0; ni < layer.length; ni++) {
      const y =
        layer.length === 1
          ? height / 2
          : padY + (usableH * ni) / (layer.length - 1);
      positions.set(layer[ni], { x, y });
    }
  }

  // Resolve category color per node
  const nodeColorMap = new Map<string, string>();
  for (const n of nodes) {
    const skill = ARIS_SKILLS.find((s) => s.id === n.skillId);
    const cat = skill?.category ?? "utility";
    nodeColorMap.set(n.id, CATEGORY_DOT_COLORS[cat]);
  }

  return (
    <svg width={width} height={height} className="block">
      {/* Edges */}
      {edges.map((e) => {
        const from = positions.get(e.source);
        const to = positions.get(e.target);
        if (!from || !to) return null;
        return (
          <line
            key={e.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={1.5}
          />
        );
      })}
      {/* Nodes */}
      {nodes.map((n) => {
        const pos = positions.get(n.id);
        if (!pos) return null;
        return (
          <circle
            key={n.id}
            cx={pos.x}
            cy={pos.y}
            r={r}
            fill={nodeColorMap.get(n.id) ?? "#6b7280"}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SetupWizard({
  isZh,
  onStartDesign,
  onLoadPipeline,
  onBack,
}: SetupWizardProps) {
  // --- State ---
  const [researchDirection, setResearchDirection] = useState("");
  const [pipelineName, setPipelineName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [attachments, setAttachments] = useState<ProgramAttachment[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [savedPipelines, setSavedPipelines] = useState<Pipeline[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Auto-generate name from research direction ---
  useEffect(() => {
    if (!nameManuallyEdited && researchDirection.trim()) {
      setPipelineName(truncate(researchDirection, 30));
    }
  }, [researchDirection, nameManuallyEdited]);

  // --- Load saved pipelines ---
  useEffect(() => {
    let cancelled = false;
    setLoadingPipelines(true);
    getPipelines().then((pipelines) => {
      if (!cancelled) {
        // Filter out templates, only show user-created pipelines
        setSavedPipelines(pipelines.filter((p) => !p.isTemplate));
        setLoadingPipelines(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Attachment handlers ---
  const addAttachment = useCallback((att: ProgramAttachment) => {
    setAttachments((prev) => [...prev, att]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const url = URL.createObjectURL(file);
        addAttachment({
          id: generateId(),
          name: file.name,
          type: file.type.startsWith("image/") ? "image" : "file",
          url,
          mimeType: file.type,
          addedAt: new Date().toISOString(),
        });
      }
    },
    [addAttachment]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      for (const file of files) {
        const url = URL.createObjectURL(file);
        addAttachment({
          id: generateId(),
          name: file.name,
          type: file.type.startsWith("image/") ? "image" : "file",
          url,
          mimeType: file.type,
          addedAt: new Date().toISOString(),
        });
      }
    },
    [addAttachment]
  );

  const handleAddLink = useCallback(() => {
    const url = linkInput.trim();
    if (!url) return;
    addAttachment({
      id: generateId(),
      name: url.replace(/^https?:\/\//, "").slice(0, 60),
      type: "link",
      url,
      addedAt: new Date().toISOString(),
    });
    setLinkInput("");
  }, [linkInput, addAttachment]);

  // --- Template selection ---
  const handleSelectTemplate = useCallback((id: string | null) => {
    setSelectedTemplateId((prev) => (prev === id ? null : id));
  }, []);

  // --- Delete saved pipeline ---
  const handleDeletePipeline = useCallback(async (id: string) => {
    await deletePipeline(id);
    setSavedPipelines((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // --- Submit ---
  const canStart = researchDirection.trim().length > 0;

  const handleStartDesign = useCallback(() => {
    if (!canStart) return;
    onStartDesign({
      name: pipelineName.trim() || truncate(researchDirection, 30),
      program: {
        brief: researchDirection,
        attachments,
        templateId: selectedTemplateId,
      },
      templateId: selectedTemplateId,
    });
  }, [
    canStart,
    pipelineName,
    researchDirection,
    attachments,
    selectedTemplateId,
    onStartDesign,
  ]);

  // --- Render ---
  return (
    <div className="w-full min-h-full overflow-y-auto bg-background">
      <div className="max-w-[800px] mx-auto px-4 py-8 space-y-10">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {isZh ? "创建自由编排流水线" : "Create Custom Pipeline"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isZh
              ? "描述你的研究方向，选择一个起点模板，然后进入可视化设计器"
              : "Describe your research direction, pick a starting template, then enter the visual designer"}
          </p>
        </div>

        {/* ============================================================= */}
        {/* Section 1: Research Context */}
        {/* ============================================================= */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {isZh ? "研究设置" : "Research Context"}
          </h2>

          {/* Research direction */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {isZh ? "研究方向" : "Research Direction"}{" "}
              <span className="text-red-500">*</span>
            </label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[100px]"
              value={researchDirection}
              onChange={(e) => setResearchDirection(e.target.value)}
              placeholder={
                isZh
                  ? "例：Exploring fine-grained recognition in Vision-Language Models using compositional contrastive learning..."
                  : "e.g. Exploring fine-grained recognition in Vision-Language Models using compositional contrastive learning..."
              }
            />
          </div>

          {/* Pipeline name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {isZh ? "流水线名称" : "Pipeline Name"}
            </label>
            <Input
              className="h-9"
              value={pipelineName}
              onChange={(e) => {
                setPipelineName(e.target.value);
                setNameManuallyEdited(true);
              }}
              placeholder={
                isZh ? "自动从研究方向生成" : "Auto-generated from research direction"
              }
            />
          </div>

          {/* Attachments */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {isZh ? "附件（可选）" : "Attachments (optional)"}
            </label>

            {/* Drop zone */}
            <div
              className={`
                border-2 border-dashed rounded-md p-4 text-center transition-colors cursor-pointer
                ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-muted-foreground/40"}
              `}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <p className="text-xs text-muted-foreground">
                {isZh
                  ? "拖拽文件到这里（PDF, JSONL, CSV, Python...）"
                  : "Drop files here (PDF, JSONL, CSV, Python...)"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept={ACCEPT_FILE_TYPES}
                onChange={handleFileSelect}
              />
            </div>

            {/* Link input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-8 text-xs pl-8"
                  placeholder={isZh ? "添加链接 (arXiv, GitHub...)" : "Add link (arXiv, GitHub...)"}
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddLink();
                  }}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs"
                onClick={handleAddLink}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Attachment chips */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((att) => (
                  <Badge
                    key={att.id}
                    variant={att.type === "link" ? "outline" : "secondary"}
                    className="text-[11px] px-2 py-0.5 gap-1"
                  >
                    {att.type === "link" ? (
                      <LinkIcon className="h-3 w-3" />
                    ) : att.type === "image" ? (
                      <FileText className="h-3 w-3" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    <span className="max-w-[180px] truncate">{att.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAttachment(att.id);
                      }}
                      className="hover:text-red-500 ml-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ============================================================= */}
        {/* Section 2: Choose Starting Point */}
        {/* ============================================================= */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {isZh ? "选择起点" : "Choose Starting Point"}
          </h2>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {/* From Scratch card */}
            <Card
              className={`cursor-pointer transition-all hover:shadow-md ${
                selectedTemplateId === null
                  ? "ring-2 ring-primary shadow-md"
                  : "hover:border-primary/40"
              }`}
              onClick={() => handleSelectTemplate(null)}
            >
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                    <Plus className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">
                      {isZh ? "空白开始" : "From Scratch"}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-1">
                <p className="text-xs text-muted-foreground mb-2">
                  {isZh
                    ? "从空白画布开始，自由拖拽技能节点"
                    : "Start with an empty canvas, drag and drop skill nodes"}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    0 {isZh ? "节点" : "nodes"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Template cards */}
            {PIPELINE_TEMPLATES.map((tpl) => {
              const isSelected = selectedTemplateId === tpl.id;
              return (
                <Card
                  key={tpl.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    isSelected
                      ? "ring-2 ring-primary shadow-md"
                      : "hover:border-primary/40"
                  }`}
                  onClick={() => handleSelectTemplate(tpl.id)}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                        {TEMPLATE_ICONS[tpl.id] ?? (
                          <FlaskConical className="h-5 w-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">
                          {isZh ? tpl.nameZh : tpl.name}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-1">
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                      {isZh ? tpl.descriptionZh : tpl.description}
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        {tpl.nodes.length} {isZh ? "节点" : "nodes"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0"
                      >
                        <Clock className="h-2.5 w-2.5 mr-0.5" />
                        {isZh
                          ? estimateTimeZh(tpl.nodes.length)
                          : estimateTime(tpl.nodes.length)}
                      </Badge>
                    </div>
                    {/* Mini DAG preview */}
                    <div className="rounded bg-muted/50 overflow-hidden">
                      <MiniDag nodes={tpl.nodes} edges={tpl.edges} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* ============================================================= */}
        {/* Section 3: Recent Pipelines */}
        {/* ============================================================= */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">
            {isZh ? "最近的流水线" : "Recent Pipelines"}
          </h2>

          {loadingPipelines ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {isZh ? "加载中..." : "Loading..."}
            </div>
          ) : savedPipelines.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {isZh
                    ? "还没有保存的流水线"
                    : "No saved pipelines yet"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {isZh
                    ? "创建的流水线会出现在这里"
                    : "Pipelines you create will appear here"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {savedPipelines.map((pipeline) => (
                <Card key={pipeline.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-3 flex items-center gap-3">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {isZh ? pipeline.nameZh || pipeline.name : pipeline.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {pipeline.nodes.length} {isZh ? "节点" : "nodes"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(pipeline.updatedAt).toLocaleDateString(
                            isZh ? "zh-CN" : "en-US",
                            { month: "short", day: "numeric" }
                          )}
                        </span>
                        {(() => {
                          const state = (pipeline as PipelineWithState).executionState;
                          if (!state?.status) return null;
                          return (
                            <Badge
                              variant={
                                state.status === "completed"
                                  ? "default"
                                  : state.status === "error"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-[10px] px-1.5 py-0"
                            >
                              {state.status}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLoadPipeline(pipeline.id);
                        }}
                        title={isZh ? "恢复" : "Resume"}
                      >
                        <Play className="h-3 w-3" />
                        {isZh ? "恢复" : "Resume"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLoadPipeline(pipeline.id);
                        }}
                        title={isZh ? "复制" : "Duplicate"}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLoadPipeline(pipeline.id);
                        }}
                        title={isZh ? "编辑" : "Edit"}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1 hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePipeline(pipeline.id);
                        }}
                        title={isZh ? "删除" : "Delete"}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ============================================================= */}
        {/* Bottom Action Bar */}
        {/* ============================================================= */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t -mx-4 px-4 py-3 flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            {isZh ? "返回" : "Cancel"}
          </Button>
          <Button
            onClick={handleStartDesign}
            disabled={!canStart}
            className="gap-1.5"
          >
            {isZh ? "进入设计" : "Enter Designer"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
