/**
 * Agent Teams Executor
 *
 * Drives multi-agent collaboration by executing each team member sequentially
 * or in parallel via the Chat API. Each agent receives:
 * - Its system prompt
 * - The task/prompt from the user
 * - Context from upstream agents (their outputs)
 *
 * Supports sequential, parallel, and hierarchical workflow modes.
 */

import type {
  AgentTeam,
  TeamMember,
  TeamRun,
  TeamNodeStatus,
  TeamEdge,
} from "../types";
import { saveTeamRun } from "../team-store";
import {
  BaseExecutor,
  topoSort,
  type ExecutionEvent,
  type ExecutionListener,
  type BaseExecutorOptions,
} from "@/lib/execution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentNode {
  id: string;
  member: TeamMember;
}

interface AgentEdge {
  id: string;
  source: string;
  target: string;
}

export interface TeamExecutorOptions extends BaseExecutorOptions {
  /** The user prompt / task to execute */
  prompt: string;
  /** Team reference for metadata */
  team: AgentTeam;
  /** Edges from the canvas (for hierarchical/custom flows) */
  edges: AgentEdge[];
}

interface AgentResult {
  memberId: string;
  output: string;
  tokens: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class TeamExecutor extends BaseExecutor<AgentNode, AgentEdge> {
  private readonly prompt: string;
  private readonly team: AgentTeam;
  private readonly results = new Map<string, AgentResult>();
  private readonly runRecord: TeamRun;
  private startTime = Date.now();

  constructor(
    team: AgentTeam,
    edges: AgentEdge[],
    listener: ExecutionListener,
    options: TeamExecutorOptions
  ) {
    const nodes: AgentNode[] = team.members.map((m) => ({
      id: m.id,
      member: m,
    }));

    // Build edges based on workflow mode if none provided
    const resolvedEdges =
      edges.length > 0 ? edges : TeamExecutor.buildEdges(team);

    super(nodes, resolvedEdges, listener, {
      maxParallel:
        team.workflow === "parallel"
          ? Math.max(team.members.length, 1)
          : options?.maxParallel ?? 1,
      resumeFrom: options?.resumeFrom,
    });

    this.prompt = options.prompt;
    this.team = team;

    // Initialize run record
    this.runRecord = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      teamId: team.id,
      status: "running",
      nodeStatuses: Object.fromEntries(
        team.members.map((m) => [m.id, "queued" as TeamNodeStatus])
      ),
      logs: [],
      startedAt: new Date().toISOString(),
    };
  }

  /** Build edges from workflow mode when no canvas edges exist */
  private static buildEdges(team: AgentTeam): AgentEdge[] {
    const edges: AgentEdge[] = [];
    const sorted = [...team.members].sort((a, b) => a.order - b.order);

    if (team.workflow === "sequential") {
      for (let i = 0; i < sorted.length - 1; i++) {
        edges.push({
          id: `e-${sorted[i].id}-${sorted[i + 1].id}`,
          source: sorted[i].id,
          target: sorted[i + 1].id,
        });
      }
    } else if (team.workflow === "hierarchical") {
      for (const m of sorted) {
        if (m.parentId) {
          edges.push({
            id: `e-${m.parentId}-${m.id}`,
            source: m.parentId,
            target: m.id,
          });
        }
      }
    }
    // parallel: no edges needed — all run independently

    return edges;
  }

  /** Get the run ID for tracking */
  getRunId(): string {
    return this.runRecord.id;
  }

  protected async executeNode(node: AgentNode): Promise<void> {
    const member = node.member;

    // Build context from upstream results
    const upstreamContext = this.buildUpstreamContext(node.id);

    // Build the full prompt
    const fullPrompt = this.buildAgentPrompt(member, upstreamContext);

    this.emit({
      type: "log",
      nodeId: node.id,
      message: `Starting agent: ${member.name} (${member.model})`,
    });

    // Execute via Chat API
    const result = await this.callAgent(member, fullPrompt);

    // Store result
    this.results.set(node.id, result);

    // Update run record
    this.runRecord.nodeStatuses[node.id] = "done";
    this.runRecord.totalTokens = (this.runRecord.totalTokens ?? 0) + result.tokens;
    this.runRecord.logs.push(
      `[${new Date().toLocaleTimeString()}] ${member.name}: ${result.tokens} tokens`
    );

    this.emit({
      type: "log",
      nodeId: node.id,
      message: `Done: ${member.name} (${result.tokens} tokens)`,
    });

    // Persist run state
    await saveTeamRun(this.runRecord).catch((err) => {
      console.error("[TeamExecutor] Failed to persist run state:", err);
      this.emit({
        type: "log",
        message: `Warning: failed to save run state — ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  }

  /** Build context string from upstream agent outputs */
  private buildUpstreamContext(nodeId: string): string {
    const upstreamIds: string[] = [];
    for (const edge of this.edges) {
      if (edge.target === nodeId) {
        upstreamIds.push(edge.source);
      }
    }

    if (upstreamIds.length === 0) return "";

    const sections = upstreamIds
      .map((id) => {
        const result = this.results.get(id);
        if (!result) return null;
        const member = this.team.members.find((m) => m.id === result.memberId);
        const name = member?.name ?? "Agent";
        return `### Output from ${name}\n${result.output}`;
      })
      .filter(Boolean);

    if (sections.length === 0) return "";

    return `\n## Previous Agent Outputs\n\n${sections.join("\n\n")}`;
  }

  /** Build the full prompt for an agent */
  private buildAgentPrompt(
    member: TeamMember,
    upstreamContext: string
  ): string {
    const parts: string[] = [];

    if (member.systemPrompt) {
      parts.push(`[System Instructions]\n${member.systemPrompt}`);
    }

    parts.push(`[Task]\n${this.prompt}`);

    if (upstreamContext) {
      parts.push(upstreamContext);
    }

    parts.push(
      "\nPlease provide your response. Be thorough and specific."
    );

    return parts.join("\n\n");
  }

  /** Call the Chat API to execute an agent */
  private async callAgent(
    member: TeamMember,
    prompt: string
  ): Promise<AgentResult> {
    try {
      const body: Record<string, unknown> = {
        message: prompt,
        provider: member.provider === "codex" ? "codex" : "claude",
        model: member.model,
      };

      // If the member uses an API key from the key store, pass it
      if (member.apiKeyId) {
        body.apiKeyId = member.apiKeyId;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`Chat API error: ${res.status}`);
      }

      // Parse SSE stream to extract final output
      const output = await this.parseSSEResponse(res);

      return {
        memberId: member.id,
        output,
        tokens: this.estimateTokens(output),
        model: member.model,
      };
    } catch (err) {
      throw new Error(
        `Agent ${member.name} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** Parse SSE response and extract the complete text output.
   *
   * The stream may contain incremental "assistant" chunks and/or a final
   * "result" event with the complete response. Strategy:
   * - Accumulate all "assistant" chunks.
   * - If a "result" event arrives with content, treat it as the authoritative
   *   complete response (it supersedes the accumulated chunks).
   * - If no "result" event is received, fall back to the accumulated chunks.
   */
  private async parseSSEResponse(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return "(no response)";

    const decoder = new TextDecoder();
    let assistantChunks = "";
    let resultContent: string | null = null;
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === "assistant" && event.content) {
              assistantChunks += event.content;
            }
            if (event.type === "result" && event.content) {
              // The result event carries the complete final response
              resultContent = event.content;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Prefer the result event (complete response) over accumulated chunks
    const output = resultContent ?? assistantChunks;
    return output || "(empty response)";
  }

  /** Rough token estimation (~4 chars per token) */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Override the run method to finalize the run record */
  async runPipeline(): Promise<TeamRun> {
    try {
      await super.run();
      this.runRecord.status = this.aborted ? "aborted" : "completed";
    } catch (err) {
      this.runRecord.status = "error";
      this.runRecord.logs.push(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    this.runRecord.completedAt = new Date().toISOString();
    this.runRecord.totalCost = this.calculateCost();
    await saveTeamRun(this.runRecord).catch((err) => {
      console.error("[TeamExecutor] Failed to persist final run record:", err);
    });

    return this.runRecord;
  }

  /** Calculate approximate cost based on model pricing */
  private calculateCost(): number {
    // Rough pricing per 1K tokens
    const pricing: Record<string, number> = {
      "claude-opus-4-6": 0.075,
      "claude-sonnet-4-6": 0.015,
      "claude-haiku-4-5-20251001": 0.00125,
      "o3": 0.06,
      "o4-mini": 0.0055,
      "gpt-4.1": 0.01,
    };

    let total = 0;
    for (const result of this.results.values()) {
      const rate = pricing[result.model] ?? 0.01;
      total += (result.tokens / 1000) * rate;
    }
    return Math.round(total * 10000) / 10000;
  }

  /** Get all agent outputs */
  getResults(): Map<string, AgentResult> {
    return new Map(this.results);
  }
}
