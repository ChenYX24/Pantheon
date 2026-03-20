"use client";

import { memo, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search, X, PanelLeftClose, PanelLeft, MessageCircle, Plus, Pin,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { timeAgo, shortModel } from "@/lib/format-utils";
import { STATUS_CONFIG } from "@/components/sessions/session-block";
import type { SessionInfo, SessionStatus } from "@/components/sessions/types";
import { useSessionMeta } from "@/hooks/use-session-meta";
import { SessionActions, getTagColor } from "@/components/sessions/session-actions";

const DEFAULT_SIDEBAR_WIDTH = 288;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 520;

interface ChatSidebarProps {
  sessions: SessionInfo[];
  selectedKey: string;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  loading?: boolean;
  onNewChat?: () => void;
  isChatMode?: boolean;
}

type DateGroup = "Pinned" | "Today" | "Yesterday" | "This Week" | "Earlier";

function getDateGroup(timestamp: number): Exclude<DateGroup, "Pinned"> {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "This Week";
  return "Earlier";
}

const GROUP_ORDER: DateGroup[] = ["Pinned", "Today", "Yesterday", "This Week", "Earlier"];

export const ChatSidebar = memo(function ChatSidebar({
  sessions,
  selectedKey,
  onSelect,
  collapsed,
  onToggleCollapse,
  loading,
  onNewChat,
  isChatMode,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const router = useRouter();
  const { getMeta, updateMeta } = useSessionMeta();

  // Filter out deleted sessions
  const visibleSessions = useMemo(() => {
    return sessions.filter(s => !getMeta(s.id).deleted);
  }, [sessions, getMeta]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return visibleSessions;
    const q = searchQuery.toLowerCase();
    return visibleSessions.filter((s) => {
      const meta = getMeta(s.id);
      return (
        s.firstMessage?.toLowerCase().includes(q) ||
        s.projectName.toLowerCase().includes(q) ||
        s.model?.toLowerCase().includes(q) ||
        meta.displayName?.toLowerCase().includes(q) ||
        meta.tags.some(t => t.toLowerCase().includes(q))
      );
    });
  }, [visibleSessions, searchQuery, getMeta]);

  const grouped = useMemo(() => {
    const groups: Record<DateGroup, SessionInfo[]> = {
      Pinned: [],
      Today: [],
      Yesterday: [],
      "This Week": [],
      Earlier: [],
    };
    for (const s of filtered) {
      if (getMeta(s.id).pinned) {
        groups.Pinned.push(s);
      } else {
        groups[getDateGroup(s.lastActive)].push(s);
      }
    }
    return groups;
  }, [filtered, getMeta]);

  // Collapsed state -- just toggle button
  if (collapsed) {
    return (
      <div className="w-12 border-r bg-card flex flex-col items-center py-3 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onToggleCollapse}
          title="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <div className="mt-4 space-y-2">
          {visibleSessions.slice(0, 5).map((s) => {
            const key = `${s.project}|${s.id}`;
            const isSelected = key === selectedKey;
            const status = (s.status || "idle") as SessionStatus;
            const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                title={getMeta(s.id).displayName || s.firstMessage?.slice(0, 60) || s.projectName}
              >
                <div className={`h-2.5 w-2.5 rounded-full ${cfg.dot} ${cfg.animation || ""}`} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const handleResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, startWidth + delta)
      );
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      data-testid="chat-sidebar"
      className="border-r bg-card flex flex-col flex-shrink-0 h-full relative"
      style={{ width: `${sidebarWidth}px` }}
    >
      {/* Header */}
      <div className="px-3 py-3 border-b flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="font-semibold text-sm flex-1">Sessions</span>
        {onNewChat && (
          <Button
            variant={isChatMode ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onNewChat}
            title="New Chat"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />New
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              onClick={() => setSearchQuery("")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {loading ? (
          <div className="space-y-2 px-2 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {searchQuery ? "No matching sessions" : "No sessions found"}
          </div>
        ) : (
          GROUP_ORDER.map((group) => {
            const items = grouped[group];
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-2">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground sticky top-0 bg-card z-10 flex items-center gap-1.5">
                  {group === "Pinned" && <Pin className="h-3 w-3" />}
                  {group}
                </div>
                <div className="space-y-0.5">
                  {items.map((s) => {
                    const key = `${s.project}|${s.id}`;
                    const isSelected = key === selectedKey;
                    const status = (s.status || "idle") as SessionStatus;
                    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
                    const meta = getMeta(s.id);
                    const displayName = meta.displayName || s.firstMessage?.slice(0, 50) || s.id.slice(0, 12);
                    const tags = meta.tags || [];

                    return (
                      <div
                        key={key}
                        className={`relative w-full text-left px-2.5 py-2 rounded-lg transition-colors group ${
                          isSelected
                            ? "bg-primary/10 border border-primary/20"
                            : "hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => onSelect(key)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <div className={`h-2 w-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot} ${cfg.animation || ""}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start gap-2 min-w-0">
                                  <div className="text-sm font-medium leading-tight min-w-0 flex-1 truncate overflow-hidden whitespace-nowrap text-ellipsis">
                                    {displayName}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                  <span className="text-xs text-muted-foreground truncate min-w-0">
                                    {s.projectName}
                                  </span>
                                  {s.model && (
                                    <Badge variant="secondary" className="text-[10px] h-3.5 px-1">
                                      {shortModel(s.model)}
                                    </Badge>
                                  )}
                                  <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                                    {timeAgo(s.lastActive)}
                                  </span>
                                </div>
                                {tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {tags.map((tag) => (
                                      <span key={tag} className={`text-[9px] px-1 py-0 rounded border ${getTagColor(tag)}`}>
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                          <div className="w-6 shrink-0 flex justify-end">
                            <SessionActions
                              sessionId={s.id}
                              meta={meta}
                              onUpdate={updateMeta}
                              onViewInSessions={() => {
                                router.push(`/sessions?highlight=${encodeURIComponent(s.id)}`);
                              }}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                                  title="Session actions"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ...
                                </Button>
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t text-xs text-muted-foreground">
        {filtered.length} session{filtered.length !== 1 ? "s" : ""}
      </div>
      <div
        data-testid="chat-sidebar-resize-handle"
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-border/80"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
});
