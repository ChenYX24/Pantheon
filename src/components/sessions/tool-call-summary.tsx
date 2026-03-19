"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Edit3,
  Eye,
  Terminal,
  FolderOpen,
  BarChart3,
  Clock,
  Files,
} from "lucide-react";
import type { SessionMessage } from "./types";
import { TOOL_CONFIG, DEFAULT_TOOL_CONFIG } from "./conv-message";
import { FileDiffView } from "./file-diff-view";
import { CategoryView, HotspotsSection } from "./tool-sub-views";
import {
  groupToolsByCategory,
  computeFileHotspots,
  type ToolCallInfo,
  type FileHotspot,
} from "@/lib/session-analysis";

interface ToolCallSummaryProps {
  messages: SessionMessage[];
  isZh: boolean;
}

interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
  rawInput?: string;
  messageIndex: number;
  timestamp?: string;
}

interface FileOperation {
  toolName: string;
  input: Record<string, unknown>;
  timestamp?: string;
  messageIndex: number;
}

function parseToolInput(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function getFilePath(input: Record<string, unknown>): string | null {
  return (input.file_path as string) || null;
}

function groupByDirectory(
  files: Map<string, FileOperation[]>
): Map<string, Map<string, FileOperation[]>> {
  const dirs = new Map<string, Map<string, FileOperation[]>>();
  for (const [filePath, ops] of files) {
    const parts = filePath.split(/[/\\]/);
    const dirPath = parts.slice(0, -1).join("/") || "/";
    if (!dirs.has(dirPath)) {
      dirs.set(dirPath, new Map());
    }
    dirs.get(dirPath)!.set(filePath, ops);
  }
  return dirs;
}

function getOpIcon(toolName: string) {
  switch (toolName) {
    case "Read":
      return Eye;
    case "Edit":
      return Edit3;
    case "Write":
      return FileText;
    default:
      return FileText;
  }
}

function getOpBadge(toolName: string, isZh: boolean) {
  switch (toolName) {
    case "Read":
      return { label: isZh ? "读取" : "Read", className: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400" };
    case "Edit":
      return { label: isZh ? "编辑" : "Edit", className: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400" };
    case "Write":
      return { label: isZh ? "创建" : "Write", className: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400" };
    default:
      return { label: toolName, className: "bg-zinc-100 dark:bg-zinc-900/40 text-zinc-700 dark:text-zinc-400" };
  }
}

function FileChangesTab({
  fileOps,
  isZh,
}: {
  fileOps: Map<string, FileOperation[]>;
  isZh: boolean;
}) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (path: string) => {
    const next = new Set(expandedFiles);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpandedFiles(next);
  };

  if (fileOps.size === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        {isZh ? "没有文件操作" : "No file operations in this session"}
      </div>
    );
  }

  const sortedFiles = [...fileOps.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );

  return (
    <div className="space-y-1">
      {sortedFiles.map(([filePath, ops]) => {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const isExpanded = expandedFiles.has(filePath);
        const hasEdits = ops.some((o) => o.toolName === "Edit");
        const hasWrites = ops.some((o) => o.toolName === "Write");

        return (
          <div
            key={filePath}
            className="border rounded-md overflow-hidden"
          >
            <button
              onClick={() => toggleFile(filePath)}
              className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/50 transition-colors text-left"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              )}
              <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs truncate flex-1">
                {fileName}
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {hasWrites && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400">
                    {isZh ? "新建" : "new"}
                  </span>
                )}
                {hasEdits && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400">
                    {ops.filter((o) => o.toolName === "Edit").length}x{" "}
                    {isZh ? "编辑" : "edit"}
                  </span>
                )}
                <Badge variant="outline" className="text-[10px] h-4">
                  {ops.length}
                </Badge>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t bg-muted/5 px-3 py-2 space-y-2">
                <div className="text-[10px] text-muted-foreground font-mono truncate mb-1">
                  {filePath}
                </div>
                {ops.map((op, i) => (
                  <div key={i}>
                    <FileDiffView
                      toolName={op.toolName}
                      input={op.input}
                      isZh={isZh}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolUsageTab({
  toolCounts,
  timeline,
  isZh,
}: {
  toolCounts: Map<string, number>;
  timeline: ParsedToolCall[];
  isZh: boolean;
}) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [viewMode, setViewMode] = useState<"bar" | "category">("bar");

  const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;

  const categories = useMemo(() => {
    const calls: ToolCallInfo[] = timeline.map((t) => ({
      name: t.name,
      input: t.input,
      timestamp: t.timestamp,
    }));
    return groupToolsByCategory(calls);
  }, [timeline]);

  return (
    <div className="space-y-4">
      {/* View mode toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setViewMode("bar")}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            viewMode === "bar"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          {isZh ? "柱状" : "Bar"}
        </button>
        <button
          onClick={() => setViewMode("category")}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            viewMode === "category"
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          {isZh ? "分类" : "Category"}
        </button>
      </div>

      {viewMode === "bar" ? (
        /* Bar chart */
        <div className="space-y-1.5">
          {sorted.map(([name, count]) => {
            const config = TOOL_CONFIG[name] || DEFAULT_TOOL_CONFIG;
            const Icon = config.icon;
            const pct = Math.round((count / maxCount) * 100);

            return (
              <div key={name} className="flex items-center gap-2">
                <div className="w-20 flex items-center gap-1.5 flex-shrink-0">
                  <Icon className={`h-3 w-3 ${config.color}`} />
                  <span className="text-xs font-mono truncate">{name}</span>
                </div>
                <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden relative">
                  <div
                    className={`h-full rounded transition-all ${config.bgColor} border ${config.borderColor}`}
                    style={{ width: `${pct}%` }}
                  />
                  <span className="absolute right-1 top-0 h-full flex items-center text-[10px] font-mono text-muted-foreground">
                    {count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <CategoryView categories={categories} isZh={isZh} />
      )}

      {/* Timeline toggle */}
      <div>
        <button
          onClick={() => setShowTimeline(!showTimeline)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Clock className="h-3 w-3" />
          {isZh ? "工具调用时间线" : "Tool Call Timeline"}
          {showTimeline ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span className="text-[10px] font-mono">({timeline.length})</span>
        </button>

        {showTimeline && (
          <div className="mt-2 max-h-64 overflow-y-auto space-y-0.5 border rounded p-2">
            {timeline.map((call, i) => {
              const config = TOOL_CONFIG[call.name] || DEFAULT_TOOL_CONFIG;
              const Icon = config.icon;
              const fp = getFilePath(call.input);
              const cmd = call.input.command as string | undefined;

              return (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs py-0.5"
                >
                  <span className="text-[10px] text-muted-foreground font-mono w-6 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <Icon className={`h-3 w-3 flex-shrink-0 ${config.color}`} />
                  <span className={`font-mono font-semibold ${config.color} flex-shrink-0`}>
                    {call.name}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {fp
                      ? fp.split(/[/\\]/).pop()
                      : cmd
                        ? cmd.slice(0, 40)
                        : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FilesModifiedTab({
  fileOps,
  hotspots,
  isZh,
}: {
  fileOps: Map<string, FileOperation[]>;
  hotspots: FileHotspot[];
  isZh: boolean;
}) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    // Auto-expand all by default
    const dirs = groupByDirectory(fileOps);
    return new Set(dirs.keys());
  });
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const dirs = useMemo(() => groupByDirectory(fileOps), [fileOps]);

  const toggleDir = (dir: string) => {
    const next = new Set(expandedDirs);
    if (next.has(dir)) next.delete(dir);
    else next.add(dir);
    setExpandedDirs(next);
  };

  const toggleFile = (fp: string) => {
    const next = new Set(expandedFiles);
    if (next.has(fp)) next.delete(fp);
    else next.add(fp);
    setExpandedFiles(next);
  };

  if (fileOps.size === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        {isZh ? "没有文件操作" : "No file operations"}
      </div>
    );
  }

  const sortedDirs = [...dirs.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return (
    <div className="space-y-1">
      <HotspotsSection hotspots={hotspots} isZh={isZh} />
      {sortedDirs.map(([dirPath, filesMap]) => {
        const isDirExpanded = expandedDirs.has(dirPath);

        return (
          <div key={dirPath}>
            <button
              onClick={() => toggleDir(dirPath)}
              className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-muted/50 rounded transition-colors text-left"
            >
              {isDirExpanded ? (
                <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              )}
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
              <span className="text-xs font-mono truncate text-muted-foreground">
                {dirPath}
              </span>
              <Badge variant="outline" className="text-[10px] h-4 ml-auto">
                {filesMap.size}
              </Badge>
            </button>

            {isDirExpanded && (
              <div className="ml-5 space-y-0.5">
                {[...filesMap.entries()].map(([fp, ops]) => {
                  const fileName = fp.split(/[/\\]/).pop() || fp;
                  const isFileExpanded = expandedFiles.has(fp);
                  // Collect unique operation types
                  const opTypes = [...new Set(ops.map((o) => o.toolName))];

                  return (
                    <div key={fp}>
                      <button
                        onClick={() => toggleFile(fp)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-muted/30 rounded transition-colors text-left"
                      >
                        {isFileExpanded ? (
                          <ChevronDown className="h-3 w-3 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 flex-shrink-0" />
                        )}
                        <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                        <span className="text-xs font-mono truncate flex-1">
                          {fileName}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {opTypes.map((op) => {
                            const badge = getOpBadge(op, isZh);
                            return (
                              <span
                                key={op}
                                className={`text-[9px] px-1 py-0.5 rounded ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            );
                          })}
                        </div>
                      </button>

                      {isFileExpanded && (
                        <div className="ml-6 py-1 space-y-1 border-l border-muted pl-2">
                          {ops.map((op, oi) => {
                            const OpIcon = getOpIcon(op.toolName);
                            const badge = getOpBadge(op.toolName, isZh);
                            return (
                              <div
                                key={oi}
                                className="flex items-start gap-1.5 text-xs"
                              >
                                <OpIcon className="h-3 w-3 flex-shrink-0 mt-0.5 text-muted-foreground" />
                                <span
                                  className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${badge.className}`}
                                >
                                  {badge.label}
                                </span>
                                {op.timestamp && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {new Date(op.timestamp).toLocaleTimeString(
                                      "zh-CN",
                                      {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      }
                                    )}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ToolCallSummary({ messages, isZh }: ToolCallSummaryProps) {
  // Extract all tool calls from messages
  const { allToolCalls, fileOps, toolCounts } = useMemo(() => {
    const calls: ParsedToolCall[] = [];
    const files = new Map<string, FileOperation[]>();
    const counts = new Map<string, number>();

    messages.forEach((msg, msgIdx) => {
      if (!msg.toolUse) return;
      for (const tool of msg.toolUse) {
        const parsed = parseToolInput(tool.input);
        calls.push({
          name: tool.name,
          input: parsed,
          rawInput: tool.input,
          messageIndex: msgIdx,
          timestamp: msg.timestamp,
        });

        // Count tool usage
        counts.set(tool.name, (counts.get(tool.name) || 0) + 1);

        // Track file operations
        const fp = getFilePath(parsed);
        if (
          fp &&
          (tool.name === "Read" ||
            tool.name === "Edit" ||
            tool.name === "Write")
        ) {
          if (!files.has(fp)) files.set(fp, []);
          files.get(fp)!.push({
            toolName: tool.name,
            input: parsed,
            timestamp: msg.timestamp,
            messageIndex: msgIdx,
          });
        }
      }
    });

    return { allToolCalls: calls, fileOps: files, toolCounts: counts };
  }, [messages]);

  const hotspots = useMemo(() => {
    const calls: ToolCallInfo[] = allToolCalls.map((t) => ({
      name: t.name,
      input: t.input,
      timestamp: t.timestamp,
    }));
    return computeFileHotspots(calls);
  }, [allToolCalls]);

  const totalTools = allToolCalls.length;
  const totalFiles = fileOps.size;
  const totalEdits = allToolCalls.filter((c) => c.name === "Edit").length;

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Header stats */}
      <div className="px-3 py-2 border-b flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">
            {totalTools} {isZh ? "工具调用" : "tool calls"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Files className="h-3 w-3" />
          {totalFiles} {isZh ? "文件" : "files"}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Edit3 className="h-3 w-3" />
          {totalEdits} {isZh ? "编辑" : "edits"}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="file-changes" className="flex-1 overflow-hidden flex flex-col">
        <TabsList className="mx-3 mt-2 flex-shrink-0">
          <TabsTrigger value="file-changes" className="text-xs">
            <Edit3 className="h-3 w-3 mr-1" />
            {isZh ? "文件变更" : "File Changes"}
          </TabsTrigger>
          <TabsTrigger value="tool-usage" className="text-xs">
            <BarChart3 className="h-3 w-3 mr-1" />
            {isZh ? "工具统计" : "Tool Usage"}
          </TabsTrigger>
          <TabsTrigger value="files-modified" className="text-xs">
            <FolderOpen className="h-3 w-3 mr-1" />
            {isZh ? "文件列表" : "Files Modified"}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto px-3 py-2">
          <TabsContent value="file-changes">
            <FileChangesTab fileOps={fileOps} isZh={isZh} />
          </TabsContent>
          <TabsContent value="tool-usage">
            <ToolUsageTab
              toolCounts={toolCounts}
              timeline={allToolCalls}
              isZh={isZh}
            />
          </TabsContent>
          <TabsContent value="files-modified">
            <FilesModifiedTab fileOps={fileOps} hotspots={hotspots} isZh={isZh} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
