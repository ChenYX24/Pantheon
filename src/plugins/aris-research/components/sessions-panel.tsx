"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
} from "lucide-react";

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

function LogViewer({ logFile, isZh }: { logFile: string; isZh: boolean }) {
  const [content, setContent] = useState("Loading...");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/aris-research/sessions/log?path=${encodeURIComponent(logFile)}&tail=200`);
      const data = await res.json();
      setContent(data.content || "(empty)");
      if (data.completed) setAutoRefresh(false);
    } catch {
      setContent("Failed to load log");
    }
  }, [logFile]);

  useEffect(() => {
    fetchLog();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLog, 3000);
    return () => clearInterval(interval);
  }, [fetchLog, autoRefresh]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-mono">{logFile}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={fetchLog}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      <pre className="bg-zinc-950 text-zinc-200 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

interface SessionsPanelProps {
  isZh: boolean;
}

export function SessionsPanel({ isZh }: SessionsPanelProps) {
  const [sessions, setSessions] = useState<ArisSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingLog, setViewingLog] = useState<ArisSession | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins/aris-research/sessions");
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleDelete = async (id: string) => {
    await fetch(`/api/plugins/aris-research/sessions?id=${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const runningCount = sessions.filter((s) => s.status === "running").length;

  if (loading) return null;
  if (sessions.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              {isZh ? "运行会话" : "Sessions"}
              {runningCount > 0 && (
                <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-0 text-[10px] px-1.5 py-0">
                  {runningCount} {isZh ? "运行中" : "running"}
                </Badge>
              )}
            </h3>
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={fetchSessions}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {sessions.slice(0, 10).map((session) => {
            const cfg = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.unknown;
            return (
              <div
                key={session.id}
                className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-accent/50 transition-colors group"
              >
                {cfg.icon}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{session.skill}</span>
                    <Badge className={`${cfg.color} border-0 text-[9px] px-1 py-0`}>
                      {isZh ? cfg.labelZh : cfg.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="text-[10px] text-muted-foreground font-mono truncate max-w-[300px]">
                      {session.command}
                    </code>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {timeAgo(session.startedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setViewingLog(session)}
                    title={isZh ? "查看日志" : "View Log"}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-500"
                    onClick={() => handleDelete(session.id)}
                    title={isZh ? "删除" : "Delete"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Log viewer dialog */}
      <Dialog open={!!viewingLog} onOpenChange={(o) => !o && setViewingLog(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4" />
              {viewingLog?.skill} — {isZh ? "日志" : "Log"}
              {viewingLog && (
                <Badge className={`${STATUS_CONFIG[viewingLog.status]?.color} border-0 text-[9px] px-1.5 py-0`}>
                  {isZh ? STATUS_CONFIG[viewingLog.status]?.labelZh : STATUS_CONFIG[viewingLog.status]?.label}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {viewingLog && <LogViewer logFile={viewingLog.logFile} isZh={isZh} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
