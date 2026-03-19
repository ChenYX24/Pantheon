"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Github,
  BookOpen,
  Rss,
  FileText,
  Search,
  Star,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  ChevronDown,
  Calendar,
  User,
  Globe,
  Code2,
  Play,
  TrendingUp,
  Plug,
  Youtube,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BriefingItem, SourceType } from "../types";

// --- Source config maps ---

const sourceIcons: Record<string, typeof Github> = {
  github: Github,
  huggingface: BookOpen,
  rss: Rss,
  arxiv: FileText,
  "web-search": Search,
  rsshub: Rss,
  youtube: Youtube,
  finance: TrendingUp,
  "custom-api": Plug,
};

const sourceLabels: Record<string, string> = {
  github: "GitHub",
  huggingface: "HuggingFace",
  rss: "RSS",
  arxiv: "arXiv",
  "web-search": "Web",
  rsshub: "RSSHub",
  youtube: "YouTube",
  finance: "Finance",
  "custom-api": "Custom API",
};

/** Accent / border colors per source */
const sourceAccentColors: Record<string, string> = {
  github: "border-l-gray-500",
  huggingface: "border-l-yellow-500",
  rss: "border-l-orange-500",
  arxiv: "border-l-red-500",
  "web-search": "border-l-blue-500",
  rsshub: "border-l-emerald-500",
  youtube: "border-l-red-500",
  finance: "border-l-amber-500",
  "custom-api": "border-l-violet-500",
};

/** Badge pill styles per source */
const sourceBadgeStyles: Record<string, string> = {
  github: "bg-gray-500/15 text-gray-600 dark:text-gray-300",
  huggingface: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  rss: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  arxiv: "bg-red-500/15 text-red-600 dark:text-red-400",
  "web-search": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  rsshub: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  youtube: "bg-red-500/15 text-red-600 dark:text-red-400",
  finance: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "custom-api": "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

/** Gradient placeholder styles for fallback thumbnails */
const sourceFallbackGradients: Record<string, string> = {
  github: "from-gray-800 to-gray-600",
  huggingface: "from-yellow-600 to-yellow-400",
  rss: "from-orange-600 to-orange-400",
  arxiv: "from-red-700 to-red-500",
  "web-search": "from-blue-600 to-blue-400",
  rsshub: "from-emerald-600 to-emerald-400",
  youtube: "from-red-600 to-red-400",
  finance: "from-amber-600 to-amber-400",
  "custom-api": "from-violet-600 to-violet-400",
};

// --- Props ---

interface BriefingCardProps {
  item: BriefingItem;
  needName?: string;
  isZh: boolean;
  viewMode?: "list" | "grid";
  onFeedback: (id: string, feedback: "good" | "bad" | "star") => void;
  onMarkRead: (id: string) => void;
}

// --- Utility: format helpers ---

function formatTimeAgo(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return "just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

function formatFullDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// --- Sub-components ---

/** Source badge pill with icon + label */
function SourceBadge({ sourceType }: { sourceType: SourceType }) {
  const Icon = sourceIcons[sourceType] ?? FileText;
  const label = sourceLabels[sourceType] ?? sourceType;
  const style = sourceBadgeStyles[sourceType] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

/** Relevance percentage badge */
function RelevanceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  if (pct <= 0) return null;
  const color =
    pct >= 80
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : pct >= 50
        ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
        : "bg-gray-500/15 text-gray-500";
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${color}`}>
      {pct}%
    </span>
  );
}

/** Meta line: author, time, stars/upvotes */
function MetaLine({ item }: { item: BriefingItem }) {
  const parts: React.ReactNode[] = [];

  if (item.author) {
    parts.push(
      <span key="author" className="truncate max-w-[120px]">
        {item.author}
      </span>
    );
  }

  parts.push(<span key="time">{formatTimeAgo(item.publishedAt)}</span>);

  if (item.stars != null && item.stars > 0) {
    parts.push(
      <span key="stars" className="inline-flex items-center gap-0.5">
        <Star className="h-3 w-3" />
        {formatNumber(item.stars)}
      </span>
    );
  }

  if (item.upvotes != null && item.upvotes > 0) {
    parts.push(
      <span key="upvotes" className="inline-flex items-center gap-0.5">
        <ThumbsUp className="h-3 w-3" />
        {item.upvotes}
      </span>
    );
  }

  if (item.language) {
    parts.push(
      <span key="lang" className="inline-flex items-center gap-0.5">
        <Code2 className="h-3 w-3" />
        {item.language}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground/40">&#183;</span>}
          {p}
        </React.Fragment>
      ))}
    </div>
  );
}

/** Feedback action buttons: star, thumbs up, thumbs down */
function FeedbackButtons({
  item,
  onFeedback,
}: {
  item: BriefingItem;
  onFeedback: (id: string, feedback: "good" | "bad" | "star") => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className={`h-7 w-7 p-0 ${
          item.userFeedback === "star" || item.isFavorite
            ? "text-yellow-500"
            : "text-muted-foreground/40 hover:text-yellow-500"
        }`}
        onClick={(e) => { stop(e); onFeedback(item.id, "star"); }}
      >
        <Star
          className="h-3.5 w-3.5"
          fill={item.userFeedback === "star" || item.isFavorite ? "currentColor" : "none"}
        />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-7 w-7 p-0 ${
          item.userFeedback === "good"
            ? "text-green-500"
            : "text-muted-foreground/40 hover:text-green-500"
        }`}
        onClick={(e) => { stop(e); onFeedback(item.id, "good"); }}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-7 w-7 p-0 ${
          item.userFeedback === "bad"
            ? "text-red-500"
            : "text-muted-foreground/40 hover:text-red-500"
        }`}
        onClick={(e) => { stop(e); onFeedback(item.id, "bad"); }}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** Gradient placeholder for items without thumbnails */
function FallbackThumbnail({
  sourceType,
  className,
  size = "small",
}: {
  sourceType: SourceType;
  className?: string;
  size?: "small" | "large";
}) {
  const Icon = sourceIcons[sourceType] ?? Globe;
  const gradient = sourceFallbackGradients[sourceType] ?? "from-gray-600 to-gray-400";
  const iconSize = size === "large" ? "h-8 w-8" : "h-5 w-5";
  return (
    <div
      className={`bg-gradient-to-br ${gradient} flex items-center justify-center rounded-md ${className ?? ""}`}
    >
      <Icon className={`${iconSize} text-white/80`} />
    </div>
  );
}

/** Tags row (collapsed: max 3, expanded: all) */
function TagsRow({ tags, maxVisible }: { tags: string[]; maxVisible?: number }) {
  const visible = maxVisible != null ? tags.slice(0, maxVisible) : tags;
  const extra = maxVisible != null ? tags.length - maxVisible : 0;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visible.map((tag) => (
        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
          {tag}
        </Badge>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-muted-foreground">+{extra}</span>
      )}
    </div>
  );
}

// --- Main component ---

export const BriefingCard = React.memo(function BriefingCard({
  item,
  needName,
  isZh,
  viewMode = "list",
  onFeedback,
  onMarkRead,
}: BriefingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const hasThumbnail = Boolean(item.thumbnail);
  const accentBorder = sourceAccentColors[item.sourceType] ?? "border-l-gray-400";

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [expanded, item.description]);

  const handleClick = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next && !item.isRead) {
      onMarkRead(item.id);
    }
  }, [expanded, item.isRead, item.id, onMarkRead]);

  // ---- Collapsed view ----

  const renderCollapsed = () => {
    if (hasThumbnail) {
      // --- Rich Card (with thumbnail) ---
      return (
        <div className="flex items-start gap-4">
          {/* Thumbnail */}
          <img
            src={item.thumbnail}
            alt=""
            className={`rounded-lg object-cover flex-shrink-0 ${
              viewMode === "grid" ? "h-24 w-36" : "h-20 w-[120px]"
            }`}
            loading="lazy"
          />

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Top row: source badge + relevance */}
            <div className="flex items-center gap-2">
              <SourceBadge sourceType={item.sourceType} />
              <RelevanceBadge score={item.relevanceScore} />
              {needName && (
                <span className="text-[11px] text-primary/70 truncate">
                  {isZh ? "需求" : "Need"}: {needName}
                </span>
              )}
              <div className="flex-1" />
              <FeedbackButtons item={item} onFeedback={onFeedback} />
            </div>

            {/* Title */}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-base font-semibold leading-snug hover:underline transition-colors line-clamp-2"
              onClick={(e) => e.stopPropagation()}
            >
              {item.title}
              <ExternalLink className="inline-block h-3.5 w-3.5 ml-1 opacity-0 group-hover:opacity-60 transition-opacity align-text-top" />
            </a>

            {/* Meta line */}
            <MetaLine item={item} />

            {/* Description */}
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
              {item.description}
            </p>

            {/* Tags */}
            <TagsRow tags={item.tags} maxVisible={3} />
          </div>

          {/* Chevron */}
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground/40 mt-1 flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      );
    }

    // --- Text Card (no thumbnail, with accent border) ---
    return (
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Top row: source badge + relevance */}
          <div className="flex items-center gap-2">
            <SourceBadge sourceType={item.sourceType} />
            <RelevanceBadge score={item.relevanceScore} />
            {needName && (
              <span className="text-[11px] text-primary/70 truncate">
                {isZh ? "需求" : "Need"}: {needName}
              </span>
            )}
            <div className="flex-1" />
            <FeedbackButtons item={item} onFeedback={onFeedback} />
          </div>

          {/* Title */}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-base font-semibold leading-snug hover:underline transition-colors line-clamp-2"
            onClick={(e) => e.stopPropagation()}
          >
            {item.title}
            <ExternalLink className="inline-block h-3.5 w-3.5 ml-1 opacity-0 group-hover:opacity-60 transition-opacity align-text-top" />
          </a>

          {/* Meta line */}
          <MetaLine item={item} />

          {/* Description (slightly larger for text-only cards) */}
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {item.description}
          </p>

          {/* Tags */}
          <TagsRow tags={item.tags} maxVisible={3} />
        </div>

        {/* Chevron */}
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground/40 mt-1 flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </div>
    );
  };

  // ---- Expanded view ----

  const renderExpanded = () => (
    <div
      ref={contentRef}
      className="overflow-hidden transition-all duration-300 ease-in-out"
      style={{
        maxHeight: expanded ? `${contentHeight + 40}px` : "0px",
        opacity: expanded ? 1 : 0,
      }}
    >
      <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
        {/* Full-width image with gradient overlay */}
        {item.thumbnail ? (
          <div className="relative rounded-lg overflow-hidden">
            <img
              src={item.thumbnail}
              alt={item.title}
              className="w-full max-h-[300px] object-cover"
              loading="lazy"
            />
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
            <h3 className="absolute bottom-3 left-4 right-4 text-white font-semibold text-lg leading-tight drop-shadow-md line-clamp-2">
              {item.title}
            </h3>
          </div>
        ) : (
          <FallbackThumbnail
            sourceType={item.sourceType}
            size="large"
            className="w-full h-32 rounded-lg"
          />
        )}

        {/* Full description */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {item.description}
        </p>

        {/* Full metadata */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {item.author && (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {item.author}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatFullDate(item.publishedAt)}
          </span>
          {item.stars != null && item.stars > 0 && (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5" />
              {item.stars.toLocaleString()} stars
            </span>
          )}
          {item.upvotes != null && item.upvotes > 0 && (
            <span className="flex items-center gap-1">
              <ThumbsUp className="h-3.5 w-3.5" />
              {item.upvotes} upvotes
            </span>
          )}
          {item.language && (
            <span className="flex items-center gap-1">
              <Code2 className="h-3.5 w-3.5" />
              {item.language}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            asChild
          >
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              {isZh ? "打开链接" : "Open Link"}
            </a>
          </Button>
          {item.githubUrl && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              asChild
            >
              <a
                href={item.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Github className="h-3.5 w-3.5 mr-1" />
                GitHub
              </a>
            </Button>
          )}
          {item.demoUrl && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              asChild
            >
              <a
                href={item.demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Globe className="h-3.5 w-3.5 mr-1" />
                Demo
              </a>
            </Button>
          )}
        </div>

        {/* All tags */}
        <TagsRow tags={item.tags} />
      </div>
    </div>
  );

  // ---- Wrapper ----

  return (
    <div
      className={`
        group relative rounded-lg border transition-all duration-200 cursor-pointer
        hover:shadow-md hover:border-primary/30
        ${!hasThumbnail ? `border-l-[3px] ${accentBorder}` : ""}
        ${!item.isRead ? "ring-1 ring-primary/20" : ""}
        ${item.isRead ? "opacity-75 bg-muted/20" : "bg-card"}
        ${viewMode === "grid" ? "p-3" : "p-4"}
      `}
      onClick={handleClick}
    >
      {/* Unread indicator dot */}
      {!item.isRead && (
        <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary animate-pulse" />
      )}

      {renderCollapsed()}
      {renderExpanded()}
    </div>
  );
});
