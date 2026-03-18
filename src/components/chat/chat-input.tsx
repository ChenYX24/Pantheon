"use client";

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Send, X, FileUp } from "lucide-react";
import { ChatCommandMenu } from "@/components/chat/chat-command-menu";
import { getFlatFilteredCommands } from "@/lib/chat-commands";
import type { ChatCommand } from "@/lib/chat-commands";

interface ChatInputProps {
  chatInput: string;
  onInputChange: (value: string) => void;
  chatSending: boolean;
  isViewingSession: boolean;
  showCommandMenu: boolean;
  allCommands: ChatCommand[];
  cmdMenuIndex: number;
  onCmdMenuIndexChange: (index: number) => void;
  onCmdMenuDismiss: () => void;
  onCommandSelect: (cmd: ChatCommand) => void;
  onSend: () => void;
  onCancel: () => void;
  placeholderContinue: string;
  placeholderNew: string;
  dropFilesLabel: string;
}

export function ChatInput({
  chatInput,
  onInputChange,
  chatSending,
  isViewingSession,
  showCommandMenu,
  allCommands,
  cmdMenuIndex,
  onCmdMenuIndexChange,
  onCmdMenuDismiss,
  onCommandSelect,
  onSend,
  onCancel,
  placeholderContinue,
  placeholderNew,
  dropFilesLabel,
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [chatInput]);

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const fileRefs = files.map((f) => `[File: ${f.name}]`).join(" ");
    onInputChange(chatInput ? `${chatInput} ${fileRefs}` : fileRefs);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [chatInput, onInputChange]);

  // Pre-compute flat filtered commands — avoids recalculating on every keystroke in handleKeyDown
  const flatFiltered = useMemo(
    () => (showCommandMenu ? getFlatFilteredCommands(allCommands, chatInput) : []),
    [showCommandMenu, allCommands, chatInput]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // ESC during sending -> cancel takes priority
    if (e.key === "Escape" && chatSending) {
      e.preventDefault();
      onCancel();
      return;
    }

    if (showCommandMenu) {
      if (e.key === "ArrowUp" && flatFiltered.length > 0) {
        e.preventDefault();
        onCmdMenuIndexChange(cmdMenuIndex <= 0 ? flatFiltered.length - 1 : cmdMenuIndex - 1);
        return;
      }
      if (e.key === "ArrowDown" && flatFiltered.length > 0) {
        e.preventDefault();
        onCmdMenuIndexChange(cmdMenuIndex >= flatFiltered.length - 1 ? 0 : cmdMenuIndex + 1);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (flatFiltered.length > 0 && cmdMenuIndex >= 0 && cmdMenuIndex < flatFiltered.length) {
          onCommandSelect(flatFiltered[cmdMenuIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        onCmdMenuDismiss();
        return;
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [chatSending, onCancel, showCommandMenu, flatFiltered, cmdMenuIndex, onCmdMenuIndexChange, onCmdMenuDismiss, onCommandSelect, onSend]);

  return (
    <div
      className="border-t bg-card px-4 py-3 flex-shrink-0 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/50 rounded-lg pointer-events-none">
          <div className="flex items-center gap-2 text-primary font-medium">
            <FileUp className="h-5 w-5" />
            <span>{dropFilesLabel}</span>
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto relative">
        {/* Slash command menu */}
        {showCommandMenu && (
          <ChatCommandMenu
            input={chatInput}
            commands={allCommands}
            selectedIndex={cmdMenuIndex}
            onSelect={onCommandSelect}
          />
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isViewingSession ? placeholderContinue : placeholderNew}
            className="flex-1 resize-none bg-muted rounded-xl px-3 sm:px-4 py-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px] max-h-[200px] touch-manipulation"
            rows={1}
            disabled={chatSending}
            role="combobox"
            aria-expanded={showCommandMenu}
            aria-controls={showCommandMenu ? "cmd-menu" : undefined}
            aria-activedescendant={showCommandMenu ? `cmd-item-${cmdMenuIndex}` : undefined}
          />
          <Button
            onClick={() => chatSending ? onCancel() : onSend()}
            disabled={!chatSending && !chatInput.trim()}
            className="h-11 w-11 rounded-xl p-0 flex-shrink-0 touch-manipulation"
            variant={chatSending ? "destructive" : "default"}
          >
            {chatSending ? <X className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
