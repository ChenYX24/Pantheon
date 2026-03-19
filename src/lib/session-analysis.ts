/**
 * Pure-logic session analysis module (no React dependencies).
 * Provides diff computation, tool grouping, token timeline, file hotspots, and insights.
 */

// ─────────────── Types ───────────────

export interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface CategoryGroup {
  category: string;
  tools: { name: string; count: number }[];
  totalCalls: number;
}

export interface TimelinePoint {
  time: string;
  inputTokens: number;
  outputTokens: number;
}

export interface FileHotspot {
  filePath: string;
  operations: number;
  lastTool: string;
}

export interface Insight {
  text: string;
  icon: string;
}

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  timestamp?: string;
}

// ─────────────── Diff ───────────────

/**
 * Compute a unified diff between two strings using LCS.
 * Falls back to simple sequential diff if either string exceeds 500 lines.
 */
export function computeUnifiedDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Fallback for large inputs: all removes then all adds
  if (oldLines.length > 500 || newLines.length > 500) {
    const result: DiffLine[] = [];
    for (let i = 0; i < oldLines.length; i++) {
      result.push({ type: "remove", content: oldLines[i], oldLineNum: i + 1 });
    }
    for (let i = 0; i < newLines.length; i++) {
      result.push({ type: "add", content: newLines[i], newLineNum: i + 1 });
    }
    return result;
  }

  // LCS-based diff
  const lcs = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];
  let oi = 0;
  let ni = 0;
  let li = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      // Context line (in LCS)
      result.push({
        type: "context",
        content: oldLines[oi],
        oldLineNum: oi + 1,
        newLineNum: ni + 1,
      });
      oi++;
      ni++;
      li++;
    } else {
      // Emit removes until we hit the next LCS line
      while (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
        result.push({ type: "remove", content: oldLines[oi], oldLineNum: oi + 1 });
        oi++;
      }
      // Emit adds until we hit the next LCS line
      while (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
        result.push({ type: "add", content: newLines[ni], newLineNum: ni + 1 });
        ni++;
      }
    }
  }

  return result;
}

/** Compute the longest common subsequence of two string arrays. */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // Build DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

// ─────────────── Tool Grouping ───────────────

const CATEGORY_MAP: Record<string, string> = {
  Read: "Read",
  Glob: "Read",
  Grep: "Read",
  Write: "Write",
  Edit: "Write",
  NotebookEdit: "Write",
  Bash: "Execute",
  WebSearch: "Web",
  WebFetch: "Web",
  Task: "Agent",
  Agent: "Agent",
  SendMessage: "Agent",
};

/**
 * Group tool calls by category (Read/Write/Execute/Web/Agent/Other).
 */
export function groupToolsByCategory(toolCalls: ToolCallInfo[]): CategoryGroup[] {
  const groups = new Map<string, Map<string, number>>();

  for (const call of toolCalls) {
    const category = CATEGORY_MAP[call.name] || "Other";
    if (!groups.has(category)) {
      groups.set(category, new Map());
    }
    const toolMap = groups.get(category)!;
    toolMap.set(call.name, (toolMap.get(call.name) || 0) + 1);
  }

  const categoryOrder = ["Read", "Write", "Execute", "Web", "Agent", "Other"];

  return categoryOrder
    .filter((cat) => groups.has(cat))
    .map((category) => {
      const toolMap = groups.get(category)!;
      const tools = [...toolMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      const totalCalls = tools.reduce((sum, t) => sum + t.count, 0);
      return { category, tools, totalCalls };
    });
}

// ─────────────── Token Timeline ───────────────

/**
 * Aggregate tokens into 20 evenly-spaced time buckets.
 */
export function computeTokenTimeline(
  messages: { timestamp?: string; usage?: { input_tokens: number; output_tokens: number } }[]
): TimelinePoint[] {
  const withTimestamps = messages.filter((m) => m.timestamp && m.usage);
  if (withTimestamps.length === 0) return [];

  const times = withTimestamps.map((m) => new Date(m.timestamp!).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  // If all messages are at the same time, return a single point
  if (maxTime === minTime) {
    const totalInput = withTimestamps.reduce((s, m) => s + (m.usage?.input_tokens || 0), 0);
    const totalOutput = withTimestamps.reduce((s, m) => s + (m.usage?.output_tokens || 0), 0);
    return [{
      time: new Date(minTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      inputTokens: totalInput,
      outputTokens: totalOutput,
    }];
  }

  const bucketCount = 20;
  const bucketSize = (maxTime - minTime) / bucketCount;
  const buckets: { inputTokens: number; outputTokens: number; time: number }[] = Array.from(
    { length: bucketCount },
    (_, i) => ({
      inputTokens: 0,
      outputTokens: 0,
      time: minTime + i * bucketSize + bucketSize / 2,
    })
  );

  for (const msg of withTimestamps) {
    const t = new Date(msg.timestamp!).getTime();
    const bucketIdx = Math.min(Math.floor((t - minTime) / bucketSize), bucketCount - 1);
    buckets[bucketIdx].inputTokens += msg.usage?.input_tokens || 0;
    buckets[bucketIdx].outputTokens += msg.usage?.output_tokens || 0;
  }

  return buckets
    .filter((b) => b.inputTokens > 0 || b.outputTokens > 0)
    .map((b) => ({
      time: new Date(b.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
    }));
}

// ─────────────── File Hotspots ───────────────

/**
 * Find the most-touched files from tool calls.
 * Returns top 10 sorted by operation count descending.
 */
export function computeFileHotspots(toolCalls: ToolCallInfo[]): FileHotspot[] {
  const FILE_TOOLS = new Set(["Read", "Write", "Edit", "Grep", "Glob"]);
  const fileMap = new Map<string, { operations: number; lastTool: string }>();

  for (const call of toolCalls) {
    if (!FILE_TOOLS.has(call.name)) continue;
    const fp =
      (call.input.file_path as string) ||
      (call.input.path as string) ||
      null;
    if (!fp) continue;

    const existing = fileMap.get(fp);
    if (existing) {
      existing.operations++;
      existing.lastTool = call.name;
    } else {
      fileMap.set(fp, { operations: 1, lastTool: call.name });
    }
  }

  return [...fileMap.entries()]
    .map(([filePath, data]) => ({
      filePath,
      operations: data.operations,
      lastTool: data.lastTool,
    }))
    .sort((a, b) => b.operations - a.operations)
    .slice(0, 10);
}

// ─────────────── Insights ───────────────

/**
 * Auto-generate 3-5 insight bullet points about the session.
 */
export function generateInsights(
  messages: { role?: string; timestamp?: string; inputTokens?: number; outputTokens?: number }[],
  toolCalls: ToolCallInfo[]
): Insight[] {
  const insights: Insight[] = [];

  // File stats
  const editedFiles = new Set<string>();
  const createdFiles = new Set<string>();
  for (const call of toolCalls) {
    const fp = call.input.file_path as string | undefined;
    if (!fp) continue;
    if (call.name === "Edit") editedFiles.add(fp);
    if (call.name === "Write") createdFiles.add(fp);
  }
  if (editedFiles.size > 0 || createdFiles.size > 0) {
    insights.push({
      text: `Modified ${editedFiles.size} files, created ${createdFiles.size} new files`,
      icon: "file",
    });
  }

  // Most used tool
  if (toolCalls.length > 0) {
    const counts = new Map<string, number>();
    for (const call of toolCalls) {
      counts.set(call.name, (counts.get(call.name) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [topName, topCount] = sorted[0];
    const pct = Math.round((topCount / toolCalls.length) * 100);
    insights.push({
      text: `Most used tool: ${topName} (${topCount} calls, ${pct}%)`,
      icon: "tool",
    });
  }

  // Session duration
  const timestamps = messages
    .filter((m) => m.timestamp)
    .map((m) => new Date(m.timestamp!).getTime());
  if (timestamps.length >= 2) {
    const minT = Math.min(...timestamps);
    const maxT = Math.max(...timestamps);
    const durationMs = maxT - minT;
    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    insights.push({
      text: `Session duration: ${hours}h ${minutes}m`,
      icon: "clock",
    });
  }

  // Total tokens
  const totalInput = messages.reduce((s, m) => s + (m.inputTokens || 0), 0);
  const totalOutput = messages.reduce((s, m) => s + (m.outputTokens || 0), 0);
  if (totalInput > 0 || totalOutput > 0) {
    const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`);
    insights.push({
      text: `Total tokens: ${fmtK(totalInput)} input + ${fmtK(totalOutput)} output`,
      icon: "zap",
    });
  }

  // Tool call count
  if (toolCalls.length > 0) {
    insights.push({
      text: `${toolCalls.length} total tool calls across ${new Set(toolCalls.map((t) => t.name)).size} tools`,
      icon: "activity",
    });
  }

  return insights;
}
