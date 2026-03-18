"use client";

import { memo, useEffect, useRef, useMemo } from "react";
import { Terminal, Zap, Hash, Bot } from "lucide-react";
import type { ChatCommand } from "@/lib/chat-commands";
import { filterCommands, groupByCategory, CATEGORY_LABELS } from "@/lib/chat-commands";
import { Badge } from "@/components/ui/badge";

interface ChatCommandMenuProps {
  input: string;
  commands: ChatCommand[];
  selectedIndex: number;
  onSelect: (cmd: ChatCommand) => void;
}

const CATEGORY_ICONS: Record<string, typeof Terminal> = {
  "built-in": Terminal,
  slash: Hash,
  skill: Zap,
  agent: Bot,
};

const CATEGORY_BADGE_COLORS: Record<string, string> = {
  "built-in": "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  slash: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  skill: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800",
  agent: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800",
};

export const ChatCommandMenu = memo(function ChatCommandMenu({ input, commands, selectedIndex, onSelect }: ChatCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCommands(commands, input), [commands, input]);
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  // Build flat list for index mapping
  const flatList = useMemo(() => {
    const list: ChatCommand[] = [];
    for (const [, cmds] of groups) list.push(...cmds);
    return list;
  }, [groups]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < flatList.length) {
      const el = menuRef.current?.querySelector(`[data-cmd-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, input]);

  if (flatList.length === 0) {
    return (
      <div
        ref={menuRef}
        className="absolute bottom-full left-0 right-0 mb-2 bg-popover border rounded-lg shadow-lg p-3 z-50"
      >
        <p className="text-sm text-muted-foreground text-center">No matching commands</p>
      </div>
    );
  }

  let globalIdx = 0;

  return (
    <div
      ref={menuRef}
      id="cmd-menu"
      role="listbox"
      aria-label="Commands"
      className="absolute bottom-full left-0 right-0 mb-2 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden"
    >
      <div className="max-h-[280px] overflow-y-auto p-1.5">
        {groups.map(([category, cmds], groupIdx) => {
          const Icon = CATEGORY_ICONS[category] || Terminal;
          const label = CATEGORY_LABELS[category] || category;
          const badgeColor = CATEGORY_BADGE_COLORS[category] || "";
          return (
            <div key={category}>
              {groupIdx > 0 && <div className="border-t mx-2 my-1" />}
              <div className="sticky top-0 z-10 bg-popover flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <Icon className="h-3 w-3" />
                {label}
              </div>
              {cmds.map((cmd) => {
                const idx = globalIdx++;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={cmd.name}
                    id={`cmd-item-${idx}`}
                    data-cmd-index={idx}
                    role="option"
                    aria-selected={isSelected}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-md transition-colors ${
                      isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                    }`}
                    onClick={() => onSelect(cmd)}
                    onPointerDown={(e) => e.preventDefault()}
                  >
                    <span className="font-mono text-sm font-medium min-w-[100px]">{cmd.name}</span>
                    <span className="text-xs text-muted-foreground truncate flex-1">{cmd.description}</span>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 flex-shrink-0 ${badgeColor}`}>
                      {label}
                    </Badge>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
