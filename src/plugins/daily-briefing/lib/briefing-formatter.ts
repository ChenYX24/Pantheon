/**
 * Briefing Formatter — formats DailyBriefing for push notifications.
 *
 * Supports Telegram (Markdown) and Feishu (interactive card JSON).
 */

import type { DailyBriefing, PushConfig } from "../types";

// ---- Telegram ----

/** Escape Telegram MarkdownV1 special characters */
function escapeTelegramMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/** Truncate to a safe length for Telegram (max 4096 chars) */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

export function formatForTelegram(
  briefing: DailyBriefing,
  config: PushConfig,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`*Daily Briefing — ${briefing.date}*`);
  lines.push("");

  // Summary
  if (config.format !== "items-only" && briefing.summary) {
    lines.push(escapeTelegramMd(briefing.summary));
    lines.push("");
  }

  // Items
  if (config.format !== "summary-only" && briefing.items.length > 0) {
    const items = briefing.items.slice(0, config.maxItems);
    for (const item of items) {
      const title = escapeTelegramMd(item.title);
      const source = escapeTelegramMd(item.source);
      if (config.includeLinks && item.url) {
        lines.push(`• [${title}](${item.url}) — ${source}`);
      } else {
        lines.push(`• ${title} — ${source}`);
      }
    }
    lines.push("");
  }

  // Footer stats
  const { total, bySource } = briefing.stats;
  const sourceSummary = Object.entries(bySource)
    .map(([src, count]) => `${src}: ${count}`)
    .join(", ");
  lines.push(`_${total} items | ${sourceSummary}_`);

  return truncate(lines.join("\n"), 4000);
}

// ---- Feishu ----

export function formatForFeishu(
  briefing: DailyBriefing,
  config: PushConfig,
): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [];

  // Summary
  if (config.format !== "items-only" && briefing.summary) {
    elements.push({
      tag: "markdown",
      content: briefing.summary,
    });
    elements.push({ tag: "hr" });
  }

  // Items
  if (config.format !== "summary-only" && briefing.items.length > 0) {
    const items = briefing.items.slice(0, config.maxItems);
    const itemLines = items.map((item) => {
      if (config.includeLinks && item.url) {
        return `- [${item.title}](${item.url}) — ${item.source}`;
      }
      return `- ${item.title} — ${item.source}`;
    });
    elements.push({
      tag: "markdown",
      content: itemLines.join("\n"),
    });
  }

  // Stats note
  const { total, bySource } = briefing.stats;
  const sourceSummary = Object.entries(bySource)
    .map(([src, count]) => `${src}: ${count}`)
    .join(", ");
  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content: `${total} items | ${sourceSummary}`,
      },
    ],
  });

  return {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: `Daily Briefing ${briefing.date}`,
        },
        template: "blue",
      },
      elements,
    },
  };
}
