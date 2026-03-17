"use client";

import { memo } from "react";
import { Loader2, Check, X, Clock } from "lucide-react";
import type { NodeStatus } from "@/lib/execution";

/** Color mapping for status dot variant */
const STATUS_DOT_COLORS: Record<NodeStatus, string> = {
  idle: "bg-muted-foreground/40",
  queued: "bg-blue-400",
  running: "bg-amber-400 animate-pulse",
  done: "bg-green-500",
  error: "bg-red-500",
  skipped: "bg-muted-foreground/20",
};

/** Color mapping for node left-border styling */
export const STATUS_BORDER_STYLES: Record<NodeStatus, string> = {
  idle: "border-l-muted-foreground/40",
  queued: "border-l-blue-400",
  running: "border-l-amber-400 animate-pulse",
  done: "border-l-green-500",
  error: "border-l-red-500",
  skipped: "border-l-muted-foreground/20",
};

/** MiniMap color mapping */
export const STATUS_MINIMAP_COLORS: Record<NodeStatus, string> = {
  idle: "#a1a1aa",
  queued: "#60a5fa",
  running: "#f59e0b",
  done: "#22c55e",
  error: "#ef4444",
  skipped: "#71717a",
};

/** Status icons (small, colored) */
const STATUS_ICONS: Record<NodeStatus, React.ReactNode> = {
  idle: <Clock className="h-3 w-3 text-muted-foreground" />,
  queued: <Clock className="h-3 w-3 text-blue-400" />,
  running: <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />,
  done: <Check className="h-3 w-3 text-green-500" />,
  error: <X className="h-3 w-3 text-red-500" />,
  skipped: <X className="h-3 w-3 text-muted-foreground/40" />,
};

export interface StatusBadgeProps {
  status: NodeStatus;
  /** "icon" renders a lucide icon, "dot" renders a small colored circle */
  variant?: "icon" | "dot";
  /** Override the default size for dot variant (default: "h-2 w-2") */
  dotSize?: string;
}

/**
 * Shared node status indicator.
 * Two variants: icon (animated lucide icons) or dot (colored circle).
 */
export const StatusBadge = memo(function StatusBadge({
  status,
  variant = "icon",
  dotSize = "h-2 w-2",
}: StatusBadgeProps) {
  if (variant === "dot") {
    return (
      <span
        className={`inline-block rounded-full ${dotSize} ${STATUS_DOT_COLORS[status]}`}
      />
    );
  }
  return <>{STATUS_ICONS[status]}</>;
});
