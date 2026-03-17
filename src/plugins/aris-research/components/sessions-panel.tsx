"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Monitor,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Trash2,
  Eye,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { ARIS_SKILLS } from "../skill-data";

interface ArisSession {
  id: string;
  skill: string;
  command: string;
  pid: number | null;
  logFile: string;
  status: "running" | "completed" | "error" | "unknown";
  startedAt: string;
  endedAt: string | null;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; labelZh: string; color: string }> = {
  running: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />,
    label: "Running", labelZh: "运行中",
    color: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
    label: "Completed", labelZh: "已完成",
    color: "bg-green-500/10 text-green-700 dark:text-green-400",
  },
  error: {
    icon: <XCircle className="h-3.5 w-3.5 text-red-500" />,
    label: "Error", labelZh: "错误",
    color: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
  unknown: {
    icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
    label: "Unknown", labelZh: "未知",
    color: "bg-muted text-muted-foreground",
  },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Colorize log lines based on content */
function colorizeLog(line: string): string {
  // Tool use patterns
  if (line.includes("Read(") || line.includes("Write(") || line.includes("Edit(")) return "text-blue-400";
  if (line.includes("Bash(") || line.includes("bash")) return "text-purple-400";
  if (line.includes("WebSearch") || line.includes("WebFetch")) return "text-cyan-400";
  if (line.includes("Glob(") || line.includes("Grep(")) return "text-indigo-400";
  if (line.includes("ERROR") || line.includes("error")) return "text-red-400";
  if (line.includes("COMPLETED") || line.includes("Success")) return "text-green-400";
  if (line.includes("Created") || line.includes("wrote") || line.includes("Wrote") || line.includes("saved")) return "text-green-300";
  if (line.startsWith("---") || line.startsWith("===")) return "text-zinc-500";
  return "";
}

/** Extract summary stats from log content */
function extractStats(content: string): { toolCalls: number; filesWritten: string[]; searchCount: number } {
  const lines = content.split("\n");
  const toolCalls = lines.filter((l) =>
    l.includes("Read(") || l.includes("Write(") || l.includes("Edit(") ||
    l.includes("Bash(") || l.includes("WebSearch") || l.includes("WebFetch") ||
    l.includes("Glob(") || l.includes("Grep(")
  ).length;
  const filesWritten = lines
    .filter((l) => l.includes("Write(") || l.includes("Created") || l.includes("wrote"))
    .map((l) => {
      const match = l.match(/(?:Write|Created|wrote)\s*\(?['"]?([^'")\s]+)/);
      return match?.[1] ?? "";
    })
    .filter(Boolean);
  const searchCount = lines.filter((l) =>
    l.includes("WebSearch") || l.includes("WebFetch") || l.includes("arxiv")
  ).length;
  return { toolCalls, filesWritten, searchCount };
}

function LogViewer({ logFile, isZh }: { logFile: string; isZh?: boolean }) {
  const [content, setContent] = useState("Loading...");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lineCount, setLineCount] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/aris-research/sessions/log?path=${encodeURIComponent(logFile)}&tail=500`);
      const data = await res.json();
      setContent(data.content || "(empty)");
      setLineCount(data.lines ?? 0);
      if (data.completed) setAutoRefresh(false);
    } catch {
      setContent("Failed to load log");
    }
  }, [logFile]);

  useEffect(() => {
    fetchLog();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLog, 2000);
    return () => clearInterval(interval);
  }, [fetchLog, autoRefresh]);

  // Auto-scroll
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content]);

  const stats = useMemo(() => extractStats(content), [content]);
  const lines = useMemo(() => content.split("\n"), [content]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-mono truncate flex-1">{logFile}</span>
        <div className="flex items-center gap-2 shrink-0">
          {autoRefresh && (
            <span className="text-[10px] text-amber-500 flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {isZh ? "实时" : "Live"}
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={fetchLog}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {lineCount > 5 && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground bg-muted/50 rounded px-2.5 py-1.5">
          <span>{lineCount} {isZh ? "行" : "lines"}</span>
          {stats.toolCalls > 0 && (
            <span className="text-blue-400">{stats.toolCalls} {isZh ? "工具调用" : "tool calls"}</span>
          )}
          {stats.searchCount > 0 && (
            <span className="text-cyan-400">{stats.searchCount} {isZh ? "搜索" : "searches"}</span>
          )}
          {stats.filesWritten.length > 0 && (
            <span className="text-green-400">{stats.filesWritten.length} {isZh ? "文件写入" : "files written"}</span>
          )}
        </div>
      )}

      {/* Files written summary */}
      {stats.filesWritten.length > 0 && (
        <div className="bg-green-950/30 border border-green-800/30 rounded px-2.5 py-1.5 text-[11px]">
          <div className="text-green-400 font-medium mb-1">{isZh ? "产出文件" : "Output Files"}</div>
          {stats.filesWritten.map((f, i) => (
            <div key={i} className="text-green-300 font-mono">{f}</div>
          ))}
        </div>
      )}

      {/* Log content with colorized lines */}
      <div className="bg-zinc-950 rounded-lg p-4 overflow-auto max-h-[50vh]">
        {lines.map((line, i) => (
          <div key={i} className={`text-xs font-mono whitespace-pre-wrap leading-relaxed ${colorizeLog(line)}`}>
            {line || "\u00A0"}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

/** Suggest next skills to run based on what just completed */
function NextStepsSuggestion({
  completedSkill,
  isZh,
  onLaunch,
}: {
  completedSkill: string;
  isZh: boolean;
  onLaunch: (skillId: string) => void;
}) {
  // Find skills that depend on the completed skill
  const nextSkills = useMemo(() => {
    // Find the completed skill's ID by name
    const completed = ARIS_SKILLS.find(
      (s) => s.name === completedSkill || s.nameZh === completedSkill
    );
    if (!completed) return [];

    // Find skills that list this as a dependency
    const dependents = ARIS_SKILLS.filter(
      (s) => s.dependencies?.includes(completed.id)
    );

    // Also add natural next steps based on common flows
    const flowMap: Record<string, string[]> = {
      "research-lit": ["idea-creator", "novelty-check"],
      "idea-creator": ["novelty-check", "research-review", "research-refine"],
      "novelty-check": ["research-refine", "experiment-plan"],
      "research-review": ["research-refine"],
      "research-refine": ["experiment-plan", "research-refine-pipeline"],
      "experiment-plan": ["run-experiment"],
      "run-experiment": ["monitor-experiment", "auto-review-loop"],
      "auto-review-loop": ["paper-plan", "paper-writing"],
      "paper-plan": ["paper-figure", "paper-write"],
      "paper-write": ["paper-compile"],
      "paper-compile": ["auto-paper-improvement-loop"],
    };

    const flowIds = flowMap[completed.id] ?? [];
    const flowSkills = flowIds
      .map((id) => ARIS_SKILLS.find((s) => s.id === id))
      .filter(Boolean) as typeof ARIS_SKILLS;

    // Merge & deduplicate
    const seen = new Set<string>();
    const result: typeof ARIS_SKILLS = [];
    for (const s of [...flowSkills, ...dependents]) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        result.push(s);
      }
    }
    return result.slice(0, 4);
  }, [completedSkill]);

  if (nextSkills.length === 0) return null;

  return (
    <div className="border-t pt-3 mt-2">
      <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
        <ArrowRight className="h-3 w-3" />
        {isZh ? "下一步建议" : "Next Steps"}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {nextSkills.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1"
            onClick={() => onLaunch(s.id)}
          >
            {isZh ? s.nameZh : s.name}
            <ArrowRight className="h-2.5 w-2.5" />
          </Button>
        ))}
      </div>
    </div>
  );
}

interface SessionsButtonProps {
  isZh: boolean;
}

export function SessionsButton({ isZh }: SessionsButtonProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ArisSession[]>([]);
  const [viewingLog, setViewingLog] = useState<ArisSession | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins/aris-research/sessions");
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchSessions();
      const interval = setInterval(fetchSessions, 5000);
      return () => clearInterval(interval);
    }
  }, [open, fetchSessions]);

  const handleDelete = async (id: string) => {
    await fetch(`/api/plugins/aris-research/sessions?id=${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const runningCount = sessions.filter((s) => s.status === "running").length;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Monitor className="h-3 w-3" />
        <span className="hidden sm:inline">{isZh ? "会话" : "Sessions"}</span>
        {runningCount > 0 && (
          <Badge className="bg-amber-500/20 text-amber-600 border-0 text-[9px] px-1 py-0 ml-0.5">
            {runningCount}
          </Badge>
        )}
      </Button>

      {/* Sessions list dialog */}
      <Dialog open={open && !viewingLog} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Monitor className="h-4 w-4" />
              {isZh ? "运行会话" : "Sessions"}
              {sessions.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{sessions.length}</Badge>
              )}
              <Button size="sm" variant="ghost" className="h-6 px-2 ml-auto" onClick={fetchSessions}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {sessions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                {isZh ? "暂无会话。启动一个技能后会在这里显示。" : "No sessions yet. Launch a skill to see it here."}
              </p>
            )}
            {sessions.map((session) => {
              const cfg = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.unknown;
              return (
                <div
                  key={session.id}
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors group"
                >
                  {cfg.icon}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{session.skill}</span>
                      <Badge className={`${cfg.color} border-0 text-[9px] px-1.5 py-0`}>
                        {isZh ? cfg.labelZh : cfg.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-[11px] text-muted-foreground font-mono truncate">
                        {session.command}
                      </code>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {timeAgo(session.startedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewingLog(session)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDelete(session.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Log viewer dialog */}
      <Dialog open={!!viewingLog} onOpenChange={(o) => { if (!o) setViewingLog(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4" />
              {viewingLog?.skill}
              {viewingLog && (
                <Badge className={`${STATUS_CONFIG[viewingLog.status]?.color} border-0 text-[9px] px-1.5 py-0`}>
                  {isZh ? STATUS_CONFIG[viewingLog.status]?.labelZh : STATUS_CONFIG[viewingLog.status]?.label}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {viewingLog && <LogViewer logFile={viewingLog.logFile} isZh={isZh} />}

          {/* Next Steps — show after completion */}
          {viewingLog?.status === "completed" && (
            <NextStepsSuggestion
              completedSkill={viewingLog.skill}
              isZh={isZh}
              onLaunch={(skillId) => {
                setViewingLog(null);
                setOpen(false);
                // Trigger skill launch via custom event (parent listens)
                window.dispatchEvent(new CustomEvent("aris-launch-skill", { detail: { skillId } }));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
