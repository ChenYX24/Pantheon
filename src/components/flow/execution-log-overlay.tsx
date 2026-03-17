"use client";

import { memo, useRef, useEffect } from "react";

export interface ExecutionLogOverlayProps {
  logs: string[];
  /** Whether to show the overlay at all. Defaults to logs.length > 0. */
  visible?: boolean;
}

/**
 * Floating log panel for execution output.
 * Auto-scrolls to bottom, color codes errors/completions.
 */
export const ExecutionLogOverlay = memo(function ExecutionLogOverlay({
  logs,
  visible,
}: ExecutionLogOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisible = visible ?? logs.length > 0;

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isVisible) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-2 left-14 right-2 max-h-[150px] bg-zinc-950/90 backdrop-blur-sm text-zinc-200 rounded-lg p-3 overflow-y-auto font-mono text-[11px] leading-relaxed border border-zinc-700 z-10"
    >
      {logs.map((log, i) => (
        <div
          key={i}
          className={getLogLineClass(log)}
        >
          {log}
        </div>
      ))}
    </div>
  );
});

function getLogLineClass(log: string): string {
  if (log.includes("ERROR") || log.includes("error") || log.includes("Error")) {
    return "text-red-400";
  }
  if (log.includes("Completed") || log.includes("completed") || log.includes("done")) {
    return "text-green-400";
  }
  return "";
}
