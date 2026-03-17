"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageCircle,
  Terminal,
  Rocket,
  Copy,
  Check,
  AlertCircle,
  GitBranch,
  Loader2,
  Settings2,
  ChevronDown,
} from "lucide-react";
import type { ArisSkill, ArisParam, SkillCategory } from "../types";
import { ARIS_SKILLS } from "../skill-data";

/** Map skill category to output directory and expected file patterns */
const CATEGORY_OUTPUT: Record<SkillCategory, { dir: string; files: string }> = {
  research: { dir: "agent-docs/knowledge/", files: "LITERATURE_SURVEY.md, IDEA_REPORT.md, NOVELTY_CHECK.md" },
  workflow: { dir: "agent-docs/plan/", files: "PIPELINE_PLAN.md, RESEARCH_PLAN.md" },
  experiment: { dir: "experiments/", files: "EXPERIMENT_PLAN.md, RESULTS.md, configs/" },
  paper: { dir: "paper/", files: "PAPER_OUTLINE.md, main.tex, figures/" },
  utility: { dir: "agent-docs/", files: "OUTPUT.md" },
};

/** Build mandatory file-output instructions for a skill */
function buildOutputInstructions(skill: ArisSkill, cwd: string): string {
  const out = CATEGORY_OUTPUT[skill.category] ?? CATEGORY_OUTPUT.utility;
  return [
    "",
    "## CRITICAL: Autonomous Execution Rules",
    "",
    "### 1. Working Directory",
    `Your working directory is: ${cwd}`,
    "ALL output files MUST be written here. Use absolute paths.",
    "",
    "### 2. File Output — MANDATORY",
    `Write complete output to \`${cwd}/${out.dir}\`.`,
    `Expected files: ${out.files}`,
    "- Use the Write tool to create well-structured markdown files",
    "- Do NOT ask the user whether to save — ALWAYS save automatically",
    "- Do NOT just print results to chat — write to FILES",
    "- Create directories if they don't exist (use Bash: mkdir -p)",
    "",
    "### 3. No Confirmation Needed",
    "- You have full permissions (--dangerously-skip-permissions)",
    "- Do NOT ask 'should I save?' or 'would you like me to write?'",
    "- Just DO it. Write files, run commands, create directories.",
    "- After writing, list all created files with their full paths.",
    "",
    "### 4. Be Thorough",
    "- If doing literature survey: cover 15-20+ papers minimum",
    "- If generating ideas: produce 8-12 well-developed ideas",
    "- If writing analysis: be detailed with tables, comparisons, citations",
    "- Read existing files in the workspace first for context",
  ].join("\n");
}

interface SkillLaunchDialogProps {
  skill: ArisSkill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  stageContext?: string;
}

/** Build the command string from skill + param values */
function buildCommand(
  skill: ArisSkill,
  values: Record<string, string>
): string {
  const params = skill.params ?? [];
  const parts: string[] = [skill.command];

  for (const param of params) {
    const val = values[param.name] || param.default;
    if (!val) continue;
    // Quote values with spaces
    if (val.includes(" ") || val.includes(",")) {
      parts.push(`"${val}"`);
    } else {
      parts.push(val);
    }
  }

  return parts.join(" ");
}

/** Check if all required params are filled */
function getValidationErrors(
  skill: ArisSkill,
  values: Record<string, string>
): string[] {
  const errors: string[] = [];
  for (const param of skill.params ?? []) {
    if (param.required && !values[param.name] && !param.default) {
      errors.push(param.name);
    }
  }
  return errors;
}

function ParamInput({
  param,
  value,
  onChange,
  hasError,
}: {
  param: ArisParam;
  value: string;
  onChange: (val: string) => void;
  hasError: boolean;
}) {
  const type = param.type ?? "text";
  const baseClass = hasError ? "border-red-500" : "";

  if (type === "select" && param.options) {
    return (
      <Select value={value || param.default} onValueChange={onChange}>
        <SelectTrigger className={`h-8 text-xs ${baseClass}`}>
          <SelectValue placeholder={param.placeholder || `Select ${param.name}`} />
        </SelectTrigger>
        <SelectContent>
          {param.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (type === "textarea") {
    return (
      <textarea
        className={`flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y ${baseClass}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder || param.description}
        rows={3}
      />
    );
  }

  if (type === "number") {
    return (
      <Input
        type="number"
        className={`h-8 text-xs ${baseClass}`}
        value={value || param.default}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.placeholder || param.default}
      />
    );
  }

  // Default: text input
  return (
    <Input
      className={`h-8 text-xs ${baseClass}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={param.placeholder || param.description}
    />
  );
}

export function SkillLaunchDialog({
  skill,
  open,
  onOpenChange,
  locale,
  stageContext = "",
}: SkillLaunchDialogProps) {
  const router = useRouter();
  const isZh = locale === "zh-CN";
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  // Launch config
  const [launchCwd, setLaunchCwd] = useState("E:\\claude-projects");
  const [launchModel, setLaunchModel] = useState("");
  const [launchPermission, setLaunchPermission] = useState<string>("trust");
  const [showConfig, setShowConfig] = useState(false);

  const params = skill?.params ?? [];
  const deps = skill?.dependencies ?? [];

  // Find dependency skill names for display
  const depSkills = useMemo(
    () => deps.map((id) => ARIS_SKILLS.find((s) => s.id === id)).filter(Boolean),
    [deps]
  );

  const validationErrors = useMemo(
    () => (skill ? getValidationErrors(skill, values) : []),
    [skill, values]
  );

  // Build command without stageContext (context is passed separately to the session API)
  const command = useMemo(() => {
    if (!skill) return "";
    return buildCommand(skill, values);
  }, [skill, values]);

  // Display command includes context for user visibility
  const displayCommand = useMemo(() => {
    if (!stageContext) return command;
    return `${command}\n# Context: ${stageContext.replace(/\n/g, " | ")}`;
  }, [command, stageContext]);

  /** Build full prompt with output instructions + context */
  const buildFullPrompt = useCallback(() => {
    if (!skill) return command;
    const parts = [command];
    if (stageContext) parts.push(`\nContext:\n${stageContext}`);
    if (launchCwd) parts.push(buildOutputInstructions(skill, launchCwd));
    return parts.join("\n");
  }, [skill, command, stageContext, launchCwd]);

  const terminalCmd = useMemo(() => {
    if (!skill) return "";
    const fullCmd = buildFullPrompt();
    const escaped = fullCmd.replace(/'/g, "'\\''");
    const cwdFlag = launchCwd ? ` --cwd '${launchCwd}'` : "";
    return `screen -dmS aris-${skill.id} bash -c 'claude --dangerously-skip-permissions${cwdFlag} "${escaped}"' && echo "Started. Attach: screen -r aris-${skill.id}"`;
  }, [skill, buildFullPrompt, launchCwd]);

  const updateValue = useCallback((name: string, val: string) => {
    setValues((prev) => ({ ...prev, [name]: val }));
  }, []);

  const handleRunInChat = () => {
    setSubmitted(true);
    if (validationErrors.length > 0) return;
    const fullCmd = buildFullPrompt();
    const params = new URLSearchParams();
    params.set("run", fullCmd);
    if (launchPermission) params.set("permission", launchPermission);
    if (launchCwd) params.set("cwd", launchCwd);
    if (launchModel) params.set("model", launchModel);
    router.push(`/chat?${params.toString()}`);
    onOpenChange(false);
    resetState();
  };

  const handleRunBackground = async () => {
    setSubmitted(true);
    if (validationErrors.length > 0 || !skill) return;
    setLaunching(true);
    try {
      // Auto-create workspace if not already in an aris- workspace
      let workspacePath = launchCwd;
      if (!workspacePath.includes("aris-")) {
        // Create a workspace from the first param value or skill name
        const topic = values[params[0]?.name] || skill.name;
        const wsRes = await fetch("/api/plugins/aris-research/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pipelineId: `standalone-${Date.now()}`,
            topic,
          }),
        });
        const wsData = await wsRes.json();
        if (wsData.workspace?.path) {
          workspacePath = wsData.workspace.path;
          setLaunchCwd(workspacePath);
        }
      }

      const fullPrompt = buildOutputInstructions(skill, workspacePath)
        ? (() => {
            const parts = [command];
            if (stageContext) parts.push(`\nContext:\n${stageContext}`);
            parts.push(buildOutputInstructions(skill, workspacePath));
            return parts.join("\n");
          })()
        : buildFullPrompt();

      const res = await fetch("/api/plugins/aris-research/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill: skill.name,
          command: fullPrompt,
          stageContext: stageContext || undefined,
          workspacePath,
        }),
      });
      if (res.ok) {
        setLaunched(true);
        setTimeout(() => {
          onOpenChange(false);
          resetState();
        }, 1500);
      }
    } catch {
      // silent
    } finally {
      setLaunching(false);
    }
  };

  const handleCopyTerminal = () => {
    setSubmitted(true);
    if (validationErrors.length > 0) return;
    navigator.clipboard.writeText(terminalCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetState = () => {
    setValues({});
    setSubmitted(false);
    setCopied(false);
    setLaunching(false);
    setLaunched(false);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) resetState();
    onOpenChange(o);
  };

  if (!skill) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isZh ? skill.nameZh : skill.name}
            <Badge
              variant={skill.tier === 3 ? "default" : skill.tier === 2 ? "secondary" : "outline"}
              className="text-[10px] px-1.5 py-0"
            >
              T{skill.tier}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isZh ? skill.descriptionZh : skill.description}
          </DialogDescription>
        </DialogHeader>

        {/* Dependencies */}
        {depSkills.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              {isZh ? "依赖：" : "Deps:"}
            </span>
            {depSkills.map((dep) => (
              <Badge key={dep!.id} variant="outline" className="text-[10px] px-1.5 py-0">
                {dep!.command}
              </Badge>
            ))}
          </div>
        )}

        {/* Parameter Form */}
        {params.length > 0 && (
          <div className="space-y-3">
            {params.map((param) => {
              const hasError =
                submitted && validationErrors.includes(param.name);
              return (
                <div key={param.name} className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{param.name}</span>
                    {param.required && (
                      <span className="text-red-500 text-xs">*</span>
                    )}
                    <span className="text-[11px] text-muted-foreground ml-auto">
                      {param.description}
                    </span>
                  </div>
                  <ParamInput
                    param={param}
                    value={values[param.name] ?? ""}
                    onChange={(val) => updateValue(param.name, val)}
                    hasError={hasError}
                  />
                  {hasError && (
                    <div className="flex items-center gap-1 text-red-500 text-[11px]">
                      <AlertCircle className="h-3 w-3" />
                      {isZh ? "必填" : "Required"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Stage Context (from research stage inputs) */}
        {stageContext && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {isZh ? "阶段上下文（自动附加）" : "Stage Context (auto-attached)"}
            </span>
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2 text-xs whitespace-pre-wrap max-h-[120px] overflow-y-auto">
              {stageContext}
            </div>
          </div>
        )}

        {/* Launch Config */}
        <div className="space-y-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowConfig(!showConfig)}
          >
            <Settings2 className="h-3 w-3" />
            {isZh ? "启动配置" : "Launch Config"}
            <ChevronDown className={`h-3 w-3 transition-transform ${showConfig ? "rotate-180" : ""}`} />
          </button>
          {showConfig && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 border rounded-lg bg-muted/30">
              {/* Working Directory */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-[11px] font-medium">{isZh ? "工作目录" : "Working Directory"}</label>
                <Input
                  className="h-7 text-xs"
                  value={launchCwd}
                  onChange={(e) => setLaunchCwd(e.target.value)}
                  placeholder="E:\claude-projects"
                />
              </div>
              {/* Model */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium">{isZh ? "模型" : "Model"}</label>
                <Select value={launchModel} onValueChange={setLaunchModel}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={isZh ? "默认" : "Default"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{isZh ? "默认" : "Default"}</SelectItem>
                    <SelectItem value="claude-opus-4-6">Opus 4.6</SelectItem>
                    <SelectItem value="claude-sonnet-4-6">Sonnet 4.6</SelectItem>
                    <SelectItem value="claude-haiku-4-5-20251001">Haiku 4.5</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Permission Mode */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium">{isZh ? "权限模式" : "Permission"}</label>
                <Select value={launchPermission} onValueChange={setLaunchPermission}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trust">{isZh ? "完全信任" : "Trust (skip permissions)"}</SelectItem>
                    <SelectItem value="default">{isZh ? "默认（需确认）" : "Default (ask)"}</SelectItem>
                    <SelectItem value="acceptEdits">{isZh ? "自动接受编辑" : "Accept Edits"}</SelectItem>
                    <SelectItem value="plan">{isZh ? "仅规划" : "Plan Only"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Command Preview */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {isZh ? "生成命令" : "Generated Command"}
          </span>
          <div className="bg-muted rounded-md px-3 py-2 font-mono text-xs break-all select-all max-h-[100px] overflow-y-auto whitespace-pre-wrap">
            {displayCommand}
          </div>
        </div>

        {/* Validation Summary */}
        {submitted && validationErrors.length > 0 && (
          <div className="flex items-center gap-1.5 text-red-500 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            {isZh
              ? `请填写必填参数：${validationErrors.join(", ")}`
              : `Required params missing: ${validationErrors.join(", ")}`}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={handleCopyTerminal}
          >
            {copied ? (
              <><Check className="h-3.5 w-3.5" />{isZh ? "已复制" : "Copied"}</>
            ) : (
              <><Terminal className="h-3.5 w-3.5" />{isZh ? "命令" : "Cmd"}</>
            )}
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={handleRunInChat}>
            <MessageCircle className="h-3.5 w-3.5" />
            Chat
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleRunBackground}
            disabled={launching || launched}
          >
            {launched ? (
              <><Check className="h-3.5 w-3.5" />{isZh ? "已启动" : "Launched"}</>
            ) : launching ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />{isZh ? "启动中..." : "Starting..."}</>
            ) : (
              <><Rocket className="h-3.5 w-3.5" />{isZh ? "后台运行" : "Run in BG"}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
