"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  ResponsiveContainer,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
import {
  FileText, Wrench, Clock, Zap, Activity,
} from "lucide-react";
import { fmtTokens } from "@/lib/format-utils";
import {
  computeTokenTimeline,
  generateInsights,
  type ToolCallInfo,
  type Insight,
} from "@/lib/session-analysis";
import type { SessionDetail } from "./types";

interface SessionAnalyticsProps {
  detail: SessionDetail;
}

// Custom Tooltip for dark mode support
function ToolTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{payload[0].name}</p>
      <p className="text-sm font-mono font-bold mt-1">{payload[0].value} calls</p>
    </div>
  );
}

// Custom Tooltip for timeline
function TimelineTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 shadow-md">
      <p className="text-sm font-medium font-mono">{label}</p>
      <div className="mt-2 space-y-1">
        <p className="text-xs text-muted-foreground">
          User: <span className="font-mono">{data.userCount}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Assistant: <span className="font-mono">{data.assistantCount}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Tokens: <span className="font-mono">{fmtTokens(data.tokens)}</span>
        </p>
      </div>
    </div>
  );
}

const TOOL_COLORS = [
  "#6366f1", // indigo
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#06b6d4", // cyan
  "#84cc16", // lime
];

const INSIGHT_ICONS: Record<string, typeof Activity> = {
  file: FileText,
  tool: Wrench,
  clock: Clock,
  zap: Zap,
  activity: Activity,
};

export function SessionAnalytics({ detail }: SessionAnalyticsProps) {
  // Calculate tool usage statistics
  const toolStats = useMemo(() => {
    const toolCounts: Record<string, number> = {};

    for (const msg of detail.messages) {
      if (msg.toolUse && msg.toolUse.length > 0) {
        for (const tool of msg.toolUse) {
          toolCounts[tool.name] = (toolCounts[tool.name] || 0) + 1;
        }
      }
    }

    return Object.entries(toolCounts)
      .map(([name, count]) => ({ name, value: count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 tools
  }, [detail.messages]);

  // Calculate message timeline by time buckets (e.g., by hour or by 10-minute intervals)
  const timeline = useMemo(() => {
    if (detail.messages.length === 0) return [];

    // Group messages by time bucket (5-minute intervals)
    const buckets: Record<string, { userCount: number; assistantCount: number; tokens: number }> = {};

    for (const msg of detail.messages) {
      if (!msg.timestamp) continue;

      const date = new Date(msg.timestamp);
      const hour = date.getHours().toString().padStart(2, "0");
      const minute = Math.floor(date.getMinutes() / 5) * 5;
      const minuteStr = minute.toString().padStart(2, "0");
      const bucket = `${hour}:${minuteStr}`;

      if (!buckets[bucket]) {
        buckets[bucket] = { userCount: 0, assistantCount: 0, tokens: 0 };
      }

      if (msg.role === "user") {
        buckets[bucket].userCount++;
      } else if (msg.role === "assistant") {
        buckets[bucket].assistantCount++;
      }

      buckets[bucket].tokens += (msg.inputTokens || 0) + (msg.outputTokens || 0);
    }

    return Object.entries(buckets)
      .map(([time, stats]) => ({
        time,
        userCount: stats.userCount,
        assistantCount: stats.assistantCount,
        tokens: stats.tokens,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [detail.messages]);

  // Compute insights
  const insights = useMemo(() => {
    const toolCalls: ToolCallInfo[] = [];
    for (const msg of detail.messages) {
      if (msg.toolUse) {
        for (const tool of msg.toolUse) {
          let parsed: Record<string, unknown> = {};
          try { parsed = tool.input ? JSON.parse(tool.input) : {}; } catch { parsed = {}; }
          toolCalls.push({ name: tool.name, input: parsed, timestamp: msg.timestamp });
        }
      }
    }
    return generateInsights(detail.messages, toolCalls);
  }, [detail.messages]);

  // Compute token timeline for sparkline
  const tokenTimeline = useMemo(() => {
    const msgs = detail.messages
      .filter((m) => m.timestamp && (m.inputTokens || m.outputTokens))
      .map((m) => ({
        timestamp: m.timestamp,
        usage: { input_tokens: m.inputTokens || 0, output_tokens: m.outputTokens || 0 },
      }));
    return computeTokenTimeline(msgs);
  }, [detail.messages]);

  const totalToolCalls = toolStats.reduce((sum, t) => sum + t.value, 0);
  const totalMessages = detail.messages.filter(m => m.role === "user" || m.role === "assistant").length;
  const userMessages = detail.messages.filter(m => m.role === "user").length;
  const assistantMessages = detail.messages.filter(m => m.role === "assistant").length;

  return (
    <div className="space-y-4 p-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMessages}</div>
            <div className="text-xs text-muted-foreground">
              {userMessages} user / {assistantMessages} assistant
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Tool Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalToolCalls}</div>
            <div className="text-xs text-muted-foreground">
              {toolStats.length} unique tools
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {insights.map((insight, i) => {
                const IconComp = INSIGHT_ICONS[insight.icon] || Activity;
                return (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <IconComp className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-foreground/70" />
                    <span>{insight.text}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Token Sparkline */}
      {tokenTimeline.length > 1 && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Token Usage Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={tokenTimeline} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(value?: number, name?: string) => [fmtTokens(value ?? 0), name === "inputTokens" ? "Input" : "Output"]}
                />
                <Area type="monotone" dataKey="inputTokens" stroke="#3b82f6" fill="url(#inputGrad)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="outputTokens" stroke="#f97316" fill="url(#outputGrad)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-3 mt-1 justify-center">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                Input
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                Output
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tool Usage Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Tool Usage Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {toolStats.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={toolStats}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    label={(props: PieLabelRenderProps) => {
                      const percent = ((props.percent ?? 0) as number) * 100;
                      return percent > 5 ? `${props.name ?? ""} ${percent.toFixed(0)}%` : "";
                    }}
                    labelLine={{ stroke: "hsl(var(--foreground))", strokeWidth: 1 }}
                  >
                    {toolStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={TOOL_COLORS[index % TOOL_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ToolTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              {/* Tool list */}
              <div className="mt-3 space-y-1.5 max-h-32 overflow-auto">
                {toolStats.map((tool, i) => (
                  <div key={tool.name} className="flex items-center gap-2 text-xs">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: TOOL_COLORS[i % TOOL_COLORS.length] }}
                    />
                    <span className="font-mono flex-1 truncate">{tool.name}</span>
                    <Badge variant="outline" className="text-xs font-mono">
                      {tool.value}
                    </Badge>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center text-muted-foreground py-6 text-sm">
              No tool usage data
            </div>
          )}
        </CardContent>
      </Card>

      {/* Message Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Message Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={timeline} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickLine={{ stroke: "hsl(var(--border))" }}
                  angle={-45}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickLine={{ stroke: "hsl(var(--border))" }}
                />
                <Tooltip content={<TimelineTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "11px" }}
                  iconSize={10}
                />
                <Bar
                  dataKey="userCount"
                  name="User"
                  fill="#6366f1"
                  stackId="messages"
                />
                <Bar
                  dataKey="assistantCount"
                  name="Assistant"
                  fill="#22c55e"
                  stackId="messages"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center text-muted-foreground py-6 text-sm">
              No timeline data
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
