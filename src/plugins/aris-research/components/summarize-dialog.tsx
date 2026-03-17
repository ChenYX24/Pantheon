"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Copy, Check } from "lucide-react";

export interface SummarizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  workspaceName: string;
  locale: string;
}

interface SummaryResult {
  summary: string;
  fileCount: number;
  totalSize: string;
}

export function SummarizeDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  locale,
}: SummarizeDialogProps) {
  const isZh = locale === "zh-CN";
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchSummary = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/plugins/aris-research/workspaces/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult({
        summary: data.summary ?? "",
        fileCount: data.fileCount ?? 0,
        totalSize: data.totalSize ?? "0 B",
      });
    } catch {
      setError(isZh ? "获取总结失败" : "Failed to fetch summary");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, isZh]);

  useEffect(() => {
    if (open && workspaceId) {
      fetchSummary();
    }
    if (!open) {
      setResult(null);
      setError(null);
      setCopied(false);
    }
  }, [open, workspaceId, fetchSummary]);

  const handleCopy = useCallback(async () => {
    if (!result?.summary) return;
    try {
      await navigator.clipboard.writeText(result.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            {isZh ? "总结" : "Summary"} — {workspaceName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{isZh ? "正在归纳..." : "Summarizing..."}</span>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 text-center py-8">{error}</p>
          )}

          {result && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {result.fileCount} {isZh ? "个文件" : "files"}
                </Badge>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {result.totalSize}
                </Badge>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 max-h-[50vh] overflow-y-auto">
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {result.summary}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          {result && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleCopy}>
              {copied ? (
                <><Check className="h-3.5 w-3.5" /> {isZh ? "已复制" : "Copied"}</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> {isZh ? "复制" : "Copy"}</>
              )}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {isZh ? "关闭" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
