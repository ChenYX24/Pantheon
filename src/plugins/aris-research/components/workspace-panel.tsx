"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FolderOpen,
  Search,
  Copy,
  Check,
  Archive,
  Trash2,
  FileText,
  Loader2,
  RefreshCw,
  FolderGit2,
  ExternalLink,
} from "lucide-react";
import { SummarizeDialog } from "./summarize-dialog";

interface Workspace {
  id: string;
  name: string;
  topic: string;
  status: "active" | "completed" | "archived";
  createdAt: string;
  stagesCompleted: number;
  stagesTotal: number;
  fileCount: number;
  totalSize: string;
  path: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; labelZh: string; color: string; borderColor: string }
> = {
  active: {
    label: "Active",
    labelZh: "活跃",
    color: "bg-green-500/10 text-green-700 dark:text-green-400",
    borderColor: "border-l-green-500",
  },
  completed: {
    label: "Completed",
    labelZh: "已完成",
    color: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    borderColor: "border-l-blue-500",
  },
  archived: {
    label: "Archived",
    labelZh: "已归档",
    color: "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",
    borderColor: "border-l-zinc-400",
  },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// --- Card Component ---
interface WorkspaceCardProps {
  workspace: Workspace;
  isZh: boolean;
  onCopyPath: (path: string) => void;
  onSummarize: (ws: Workspace) => void;
  onArchive: (ws: Workspace) => void;
  onDelete: (ws: Workspace) => void;
  onRename: (id: string, name: string) => void;
}

const WorkspaceCard = React.memo(function WorkspaceCard({
  workspace: ws,
  isZh,
  onCopyPath,
  onSummarize,
  onArchive,
  onDelete,
  onRename,
}: WorkspaceCardProps) {
  const cfg = STATUS_CONFIG[ws.status] ?? STATUS_CONFIG.active;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(ws.name);
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== ws.name) {
      onRename(ws.id, trimmed);
    } else {
      setEditName(ws.name);
    }
    setEditing(false);
  }, [editName, ws.id, ws.name, onRename]);

  // Load file list when expanded
  const handleToggleExpand = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && files.length === 0) {
      setLoadingFiles(true);
      try {
        const res = await fetch(`/api/browse?path=${encodeURIComponent(ws.path)}`);
        const data = await res.json();
        // Flatten: show .md files from key directories
        const items: string[] = (data.entries ?? [])
          .map((e: { name: string; type: string }) => e.name)
          .filter((n: string) => !n.startsWith("."));
        setFiles(items);
      } catch {
        setFiles(["(unable to list files)"]);
      }
      setLoadingFiles(false);
    }
  }, [expanded, files.length, ws.path]);

  return (
    <div
      className={`flex flex-col gap-1.5 p-3 rounded-lg border border-l-[3px] ${cfg.borderColor} hover:bg-accent/40 transition-colors shadow-sm`}
    >
      {/* Top row: name + status + expand toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              className="h-7 text-sm font-medium px-1.5"
              value={editName}
              autoFocus
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
                if (e.key === "Escape") { setEditName(ws.name); setEditing(false); }
              }}
            />
          ) : (
            <button
              className="text-sm font-medium text-left truncate block max-w-full hover:underline cursor-text"
              onClick={() => { setEditing(true); setEditName(ws.name); }}
              title={isZh ? "点击编辑名称" : "Click to rename"}
            >
              {ws.name}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge className={`${cfg.color} border-0 text-[9px] px-1.5 py-0`}>
            {isZh ? cfg.labelZh : cfg.label}
          </Badge>
        </div>
      </div>

      {/* Info: date + stats */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span title={formatDate(ws.createdAt)}>{timeAgo(ws.createdAt)}</span>
        {ws.fileCount > 0 && <span>{ws.fileCount} {isZh ? "个文件" : "files"}</span>}
        {ws.totalSize && <span>{ws.totalSize}</span>}
      </div>

      {/* Actions row — compact and clear */}
      <div className="flex items-center gap-0.5 -mx-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2 gap-1"
          onClick={handleToggleExpand}
          title={isZh ? "展开/折叠文件列表" : "Toggle file list"}
        >
          <FolderOpen className="h-3 w-3" />
          {isZh ? (expanded ? "收起" : "文件") : (expanded ? "Collapse" : "Files")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2 gap-1"
          onClick={() => {
            // Open folder in system file explorer
            fetch(`/api/browse?open=${encodeURIComponent(ws.path)}`).catch(() => {});
            onCopyPath(ws.path);
          }}
          title={isZh ? "在资源管理器中打开" : "Open in Explorer"}
        >
          <ExternalLink className="h-3 w-3" />
          {isZh ? "打开" : "Open"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2 gap-1"
          onClick={() => onSummarize(ws)}
          title={isZh ? "生成所有产出的结构化摘要" : "Generate structured summary of all outputs"}
        >
          <FileText className="h-3 w-3" />
          {isZh ? "总结" : "Summary"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2 gap-1"
          onClick={() => onCopyPath(ws.path)}
          title={isZh ? "复制路径到剪贴板" : "Copy path to clipboard"}
        >
          <Copy className="h-3 w-3" />
          {isZh ? "复制路径" : "Copy Path"}
        </Button>
        <div className="flex-1" />
        {ws.status !== "archived" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2 gap-1 text-muted-foreground"
            onClick={() => onArchive(ws)}
          >
            <Archive className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-1.5 text-red-400 hover:text-red-600"
          onClick={() => onDelete(ws)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Expandable file list */}
      {expanded && (
        <div className="bg-muted/50 rounded p-2 text-[11px] font-mono max-h-[120px] overflow-y-auto">
          {loadingFiles ? (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading...
            </div>
          ) : files.length === 0 ? (
            <span className="text-muted-foreground">{isZh ? "空目录" : "Empty directory"}</span>
          ) : (
            files.map((f) => (
              <div key={f} className="flex items-center gap-1.5 py-0.5">
                <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate">{f}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

// --- Confirmation Dialog ---
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}

function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel, onConfirm, destructive }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Panel ---
export interface WorkspacePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
}

export function WorkspacePanel({ open, onOpenChange, locale }: WorkspacePanelProps) {
  const isZh = locale === "zh-CN";

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortDesc, setSortDesc] = useState(true);

  // Summarize dialog
  const [summarizeWs, setSummarizeWs] = useState<Workspace | null>(null);

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<{
    type: "archive" | "delete";
    ws: Workspace;
  } | null>(null);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plugins/aris-research/workspaces");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchWorkspaces();
    }
  }, [open, fetchWorkspaces]);

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // ignore
    }
  }, []);

  const handleRename = useCallback(async (id: string, name: string) => {
    try {
      await fetch("/api/plugins/aris-research/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === id ? { ...ws, name } : ws))
      );
    } catch {
      // ignore
    }
  }, []);

  const handleArchive = useCallback(async (ws: Workspace) => {
    try {
      await fetch("/api/plugins/aris-research/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ws.id, status: "archived" }),
      });
      setWorkspaces((prev) =>
        prev.map((w) => (w.id === ws.id ? { ...w, status: "archived" as const } : w))
      );
    } catch {
      // ignore
    }
  }, []);

  const handleDelete = useCallback(async (ws: Workspace) => {
    try {
      await fetch(`/api/plugins/aris-research/workspaces?id=${ws.id}`, {
        method: "DELETE",
      });
      setWorkspaces((prev) => prev.filter((w) => w.id !== ws.id));
    } catch {
      // ignore
    }
  }, []);

  // Filtered + sorted workspaces
  const filteredWorkspaces = useMemo(() => {
    let list = workspaces;

    // Status filter
    if (statusFilter !== "all") {
      list = list.filter((ws) => ws.status === statusFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (ws) =>
          ws.name.toLowerCase().includes(q) ||
          ws.topic.toLowerCase().includes(q) ||
          ws.path.toLowerCase().includes(q)
      );
    }

    // Sort by date
    const sorted = [...list].sort((a, b) => {
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return sortDesc ? diff : -diff;
    });

    return sorted;
  }, [workspaces, statusFilter, searchQuery, sortDesc]);

  const activeCount = workspaces.filter((ws) => ws.status === "active").length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FolderGit2 className="h-4 w-4" />
              {isZh ? "工作区" : "Workspaces"}
              {workspaces.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {workspaces.length}
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 ml-auto"
                onClick={fetchWorkspaces}
                disabled={loading}
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </DialogTitle>
          </DialogHeader>

          {/* Toolbar: search + filter + sort */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 text-xs pl-8"
                placeholder={isZh ? "搜索工作区..." : "Search workspaces..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isZh ? "全部" : "All"}</SelectItem>
                <SelectItem value="active">{isZh ? "活跃" : "Active"}</SelectItem>
                <SelectItem value="completed">{isZh ? "已完成" : "Completed"}</SelectItem>
                <SelectItem value="archived">{isZh ? "已归档" : "Archived"}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs px-2"
              onClick={() => setSortDesc((prev) => !prev)}
              title={isZh ? "切换排序" : "Toggle sort"}
            >
              {sortDesc ? "Newest" : "Oldest"}
            </Button>
          </div>

          {/* Workspace list */}
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {loading && workspaces.length === 0 && (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{isZh ? "加载中..." : "Loading..."}</span>
              </div>
            )}

            {!loading && filteredWorkspaces.length === 0 && (
              <div className="text-center py-12">
                <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery || statusFilter !== "all"
                    ? (isZh ? "没有匹配的工作区" : "No matching workspaces")
                    : (isZh
                        ? "暂无工作区。运行 Pipeline 后会自动创建。"
                        : "No workspaces yet. Run a pipeline to create one.")}
                </p>
              </div>
            )}

            {filteredWorkspaces.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                isZh={isZh}
                onCopyPath={handleCopyPath}
                onSummarize={setSummarizeWs}
                onArchive={(w) => setConfirmAction({ type: "archive", ws: w })}
                onDelete={(w) => setConfirmAction({ type: "delete", ws: w })}
                onRename={handleRename}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Summarize dialog */}
      <SummarizeDialog
        open={!!summarizeWs}
        onOpenChange={(o) => { if (!o) setSummarizeWs(null); }}
        workspaceId={summarizeWs?.id ?? null}
        workspaceName={summarizeWs?.name ?? ""}
        locale={locale}
      />

      {/* Confirm dialog for archive/delete */}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(o) => { if (!o) setConfirmAction(null); }}
        title={
          confirmAction?.type === "archive"
            ? (isZh ? "确认归档" : "Confirm Archive")
            : (isZh ? "确认移除" : "Confirm Remove")
        }
        message={
          confirmAction?.type === "archive"
            ? (isZh
                ? `将 "${confirmAction?.ws.name}" 标记为已归档？`
                : `Mark "${confirmAction?.ws.name}" as archived?`)
            : (isZh
                ? `从索引中移除 "${confirmAction?.ws.name}"？文件不会被删除。`
                : `Remove "${confirmAction?.ws.name}" from index? Files will not be deleted.`)
        }
        confirmLabel={
          confirmAction?.type === "archive"
            ? (isZh ? "归档" : "Archive")
            : (isZh ? "移除" : "Remove")
        }
        destructive={confirmAction?.type === "delete"}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.type === "archive") {
            handleArchive(confirmAction.ws);
          } else {
            handleDelete(confirmAction.ws);
          }
        }}
      />
    </>
  );
}

// --- Button for header ---
export interface WorkspacesButtonProps {
  isZh: boolean;
  locale: string;
}

export function WorkspacesButton({ isZh, locale }: WorkspacesButtonProps) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetch("/api/plugins/aris-research/workspaces")
      .then((res) => res.json())
      .then((data) => {
        const wsList = data.workspaces ?? [];
        setCount(wsList.filter((w: Workspace) => w.status === "active").length);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5"
        onClick={() => setOpen(true)}
      >
        <FolderOpen className="h-3 w-3" />
        <span className="hidden sm:inline">{isZh ? "工作区" : "Workspaces"}</span>
        {count > 0 && (
          <Badge className="bg-green-500/20 text-green-600 border-0 text-[9px] px-1 py-0 ml-0.5">
            {count}
          </Badge>
        )}
      </Button>

      <WorkspacePanel open={open} onOpenChange={setOpen} locale={locale} />
    </>
  );
}
