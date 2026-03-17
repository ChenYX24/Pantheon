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
} from "lucide-react";
import type { ArisSkill, ArisParam } from "../types";
import { ARIS_SKILLS } from "../skill-data";

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

  const command = useMemo(() => {
    if (!skill) return "";
    const base = buildCommand(skill, values);
    if (!stageContext) return base;
    // Append context after the command: /skill "args" — context
    return `${base} — ${stageContext.replace(/\n/g, " | ")}`;
  }, [skill, values, stageContext]);

  const terminalCmd = useMemo(() => {
    if (!skill) return "";
    return `screen -dmS aris-${skill.id} bash -c 'claude "${command}"' && echo "Started. Attach: screen -r aris-${skill.id}"`;
  }, [skill, command]);

  const updateValue = useCallback((name: string, val: string) => {
    setValues((prev) => ({ ...prev, [name]: val }));
  }, []);

  const handleRunInChat = () => {
    setSubmitted(true);
    if (validationErrors.length > 0) return;
    router.push(`/chat?run=${encodeURIComponent(command)}`);
    onOpenChange(false);
    resetState();
  };

  const handleRunBackground = async () => {
    setSubmitted(true);
    if (validationErrors.length > 0) return;
    setLaunching(true);
    try {
      const res = await fetch("/api/plugins/aris-research/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: skill?.name ?? "unknown", command }),
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

        {/* Command Preview */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {isZh ? "生成命令" : "Generated Command"}
          </span>
          <div className="bg-muted rounded-md px-3 py-2 font-mono text-xs break-all select-all max-h-[100px] overflow-y-auto">
            {command}
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
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleCopyTerminal}
          >
            {copied ? (
              <><Check className="h-3.5 w-3.5" />{isZh ? "已复制" : "Copied"}</>
            ) : (
              <><Terminal className="h-3.5 w-3.5" />{isZh ? "复制命令" : "Copy Cmd"}</>
            )}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleRunInChat}>
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
