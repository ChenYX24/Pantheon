"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Tag,
  Trash2,
  Copy,
  ExternalLink,
} from "lucide-react";
import type { SessionMetaEntry } from "@/hooks/use-session-meta";

const TAG_PRESETS = [
  { label: "Important", color: "blue" },
  { label: "Bug Fix", color: "red" },
  { label: "Feature", color: "green" },
  { label: "Research", color: "purple" },
  { label: "Review", color: "yellow" },
] as const;

export const TAG_COLORS: Record<string, string> = {
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  red: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  green: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  purple: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
  yellow: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  default: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-500/30",
};

export function getTagColor(tag: string): string {
  const preset = TAG_PRESETS.find((t) => t.label === tag);
  return TAG_COLORS[preset?.color ?? "default"];
}

interface SessionActionsProps {
  sessionId: string;
  meta: SessionMetaEntry;
  onUpdate: (
    sessionId: string,
    updates: Partial<Pick<SessionMetaEntry, "displayName" | "pinned" | "tags" | "deleted">>
  ) => void;
  onViewInSessions?: () => void;
  trigger?: React.ReactNode;
}

export function SessionActions({
  sessionId,
  meta,
  onUpdate,
  onViewInSessions,
  trigger,
}: SessionActionsProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameName, setRenameName] = useState(meta.displayName || "");

  const handleRename = () => {
    const trimmed = renameName.trim();
    onUpdate(sessionId, { displayName: trimmed || null });
    setRenameOpen(false);
  };

  const handleTogglePin = () => {
    onUpdate(sessionId, { pinned: !meta.pinned });
  };

  const handleToggleTag = (tagLabel: string) => {
    const current = meta.tags || [];
    const next = current.includes(tagLabel)
      ? current.filter((t) => t !== tagLabel)
      : [...current, tagLabel];
    onUpdate(sessionId, { tags: next });
  };

  const handleDelete = () => {
    onUpdate(sessionId, { deleted: true });
    setDeleteOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger || (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(sessionId);
            }}
          >
            <Copy className="h-3.5 w-3.5 mr-2" />
            Copy Session ID
          </DropdownMenuItem>
          {onViewInSessions && (
            <DropdownMenuItem onClick={onViewInSessions}>
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Open in Sessions
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setRenameName(meta.displayName || "");
              setRenameOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleTogglePin}>
            {meta.pinned ? (
              <>
                <PinOff className="h-3.5 w-3.5 mr-2" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="h-3.5 w-3.5 mr-2" />
                Pin to Top
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag className="h-3.5 w-3.5 mr-2" />
              Tags
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              {TAG_PRESETS.map((preset) => {
                const active = meta.tags?.includes(preset.label);
                return (
                  <DropdownMenuItem
                    key={preset.label}
                    onClick={() => handleToggleTag(preset.label)}
                  >
                    <div
                      className={`h-2.5 w-2.5 rounded-full mr-2 ${
                        TAG_COLORS[preset.color].split(" ")[0]
                      }`}
                      style={{
                        backgroundColor: active ? undefined : undefined,
                        opacity: active ? 1 : 0.5,
                      }}
                    />
                    <span className={active ? "font-medium" : ""}>
                      {preset.label}
                    </span>
                    {active && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        ✓
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDeleteOpen(true)}
            className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
            <DialogDescription>
              Enter a custom display name for this session.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Custom session name..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Session</DialogTitle>
            <DialogDescription>
              This will hide the session from the list. The original session data
              is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
