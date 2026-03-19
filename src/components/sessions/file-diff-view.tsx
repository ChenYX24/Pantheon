"use client";

import { memo, useMemo, useState } from "react";
import { Copy, Check, FileText, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeUnifiedDiff, type DiffLine } from "@/lib/session-analysis";

interface FileDiffViewProps {
  toolName: string;
  input: Record<string, unknown>;
  isZh: boolean;
}

/** Basic keyword highlighting for common programming tokens */
function highlightLine(line: string): React.ReactNode {
  // Simple keyword detection - bold common keywords
  const keywords = /\b(function|const|let|var|return|import|export|from|if|else|for|while|class|interface|type|async|await|new|this|true|false|null|undefined|default)\b/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const text = line;
  // Reset regex
  keywords.lastIndex = 0;

  while ((match = keywords.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className="font-bold">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : line;
}

function UnifiedDiffLines({
  oldStr,
  newStr,
}: {
  oldStr: string;
  newStr: string;
}) {
  const diffLines = useMemo(() => computeUnifiedDiff(oldStr, newStr), [oldStr, newStr]);

  const addCount = diffLines.filter((l) => l.type === "add").length;
  const removeCount = diffLines.filter((l) => l.type === "remove").length;

  return (
    <div className="font-mono text-xs leading-relaxed overflow-x-auto">
      {/* Change summary badge */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/30 border-b border-muted text-[10px]">
        <span className="text-green-600 dark:text-green-400 font-semibold">+{addCount}</span>
        <span className="text-red-600 dark:text-red-400 font-semibold">-{removeCount}</span>
      </div>
      {/* Unified diff lines */}
      {diffLines.map((line, i) => {
        const bgClass =
          line.type === "remove"
            ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
            : line.type === "add"
              ? "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400"
              : "";
        const signChar = line.type === "remove" ? "-" : line.type === "add" ? "+" : " ";
        const signColor =
          line.type === "remove"
            ? "text-red-400 dark:text-red-600"
            : line.type === "add"
              ? "text-green-400 dark:text-green-600"
              : "text-transparent";
        const gutterColor =
          line.type === "remove"
            ? "text-red-400 dark:text-red-600"
            : line.type === "add"
              ? "text-green-400 dark:text-green-600"
              : "text-muted-foreground/50";

        return (
          <div key={i} className={`${bgClass} px-2 py-0.5 flex`}>
            {/* Old line number gutter */}
            <span className={`${gutterColor} select-none w-5 flex-shrink-0 text-right mr-0.5`}>
              {line.oldLineNum ?? ""}
            </span>
            {/* New line number gutter */}
            <span className={`${gutterColor} select-none w-5 flex-shrink-0 text-right mr-1.5`}>
              {line.newLineNum ?? ""}
            </span>
            {/* Sign */}
            <span className={`select-none ${signColor} mr-1 flex-shrink-0`}>
              {signChar}
            </span>
            {/* Content */}
            <span className="whitespace-pre-wrap break-words min-w-0">
              {highlightLine(line.content)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const FileDiffView = memo(function FileDiffView({
  toolName,
  input,
  isZh,
}: FileDiffViewProps) {
  const [copied, setCopied] = useState(false);

  const filePath = (input.file_path as string) || "";
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const copyPath = () => {
    navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (toolName === "Edit") {
    const oldString = (input.old_string as string) || "";
    const newString = (input.new_string as string) || "";
    const replaceAll = input.replace_all as boolean;

    return (
      <div className="mt-1.5 space-y-1">
        {/* File path header */}
        {filePath && (
          <div className="flex items-center gap-1.5 px-1">
            <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-xs text-muted-foreground truncate flex-1">
              {filePath}
            </span>
            {replaceAll && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400">
                {isZh ? "全部替换" : "replace all"}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={copyPath}
              title={isZh ? "复制路径" : "Copy path"}
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        )}
        {/* Diff view */}
        <div className="rounded border border-muted overflow-hidden">
          <UnifiedDiffLines oldStr={oldString} newStr={newString} />
        </div>
      </div>
    );
  }

  if (toolName === "Write") {
    const content = (input.content as string) || "";
    const previewLines = content.split("\n").slice(0, 20);
    const hasMore = content.split("\n").length > 20;

    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center gap-1.5 px-1">
          <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs text-muted-foreground truncate flex-1">
            {filePath}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400">
            {isZh ? "创建文件" : "Created"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={copyPath}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
        <div className="rounded border border-muted overflow-hidden">
          <pre className="font-mono text-xs px-2 py-1.5 bg-muted/20 max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
            {previewLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="text-muted-foreground select-none w-5 flex-shrink-0 text-right mr-2">
                  {i + 1}
                </span>
                <span>{highlightLine(line)}</span>
              </div>
            ))}
            {hasMore && (
              <div className="text-muted-foreground/60 italic mt-1">
                ... {content.split("\n").length - 20}{" "}
                {isZh ? "更多行" : "more lines"}
              </div>
            )}
          </pre>
        </div>
      </div>
    );
  }

  if (toolName === "Bash") {
    const command = (input.command as string) || "";
    const description = (input.description as string) || "";

    return (
      <div className="mt-1.5">
        {description && (
          <div className="text-[10px] text-muted-foreground mb-1 px-1">
            {description}
          </div>
        )}
        <div className="bg-zinc-900 dark:bg-black/80 rounded border border-zinc-700 overflow-hidden">
          <pre className="font-mono text-xs text-green-400 px-3 py-2 whitespace-pre-wrap break-words">
            <span className="text-zinc-500 select-none">$ </span>
            {command}
          </pre>
        </div>
      </div>
    );
  }

  if (toolName === "Read") {
    const offset = (input.offset as number) || 0;
    const limit = (input.limit as number) || undefined;

    return (
      <div className="mt-1.5">
        <div className="flex items-center gap-1.5 px-1">
          <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-xs text-muted-foreground truncate flex-1">
            {filePath}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400">
            {isZh ? "读取" : "Read"}
          </span>
          {(offset > 0 || limit) && (
            <span className="text-[10px] text-muted-foreground font-mono">
              L{offset + 1}
              {limit ? `-${offset + limit}` : "+"}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Grep / Glob / other tools - show a compact summary
  return (
    <div className="mt-1.5">
      <pre className="font-mono text-[11px] text-muted-foreground px-2 py-1 bg-muted/20 rounded whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
        {JSON.stringify(input, null, 2).slice(0, 500)}
      </pre>
    </div>
  );
});
