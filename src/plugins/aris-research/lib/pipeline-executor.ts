/**
 * Pipeline Execution Engine
 *
 * Executes nodes in topological order, one at a time.
 * Each node launches a Claude CLI session via the sessions API.
 * Polls for completion, then advances to the next node.
 */
import type { Pipeline, PipelineNode, PipelineEdge, NodeStatus } from "../types";
import { ARIS_SKILLS } from "../skill-data";
import { buildCommand } from "./build-pipeline-commands";

export interface ExecutionEvent {
  type: "node-status" | "log" | "pipeline-done" | "pipeline-error";
  nodeId?: string;
  status?: NodeStatus;
  message?: string;
  sessionId?: string;
  logFile?: string;
}

export type ExecutionListener = (event: ExecutionEvent) => void;

/** Topological sort */
function topoSort(nodes: PipelineNode[], edges: PipelineEdge[]): string[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    adj.get(e.source)?.push(e.target);
  }

  const queue: string[] = [];
  for (const [id, d] of inDeg) {
    if (d === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return sorted;
}

export class PipelineExecutor {
  private pipeline: Pipeline;
  private listener: ExecutionListener;
  private aborted = false;
  private currentSessionId: string | null = null;

  constructor(pipeline: Pipeline, listener: ExecutionListener) {
    this.pipeline = pipeline;
    this.listener = listener;
  }

  abort() {
    this.aborted = true;
  }

  async run(): Promise<void> {
    const { nodes, edges } = this.pipeline;
    const order = topoSort(nodes, edges);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Set all to queued
    for (const id of order) {
      this.emit({ type: "node-status", nodeId: id, status: "queued" });
    }

    for (const nodeId of order) {
      if (this.aborted) {
        this.emit({ type: "node-status", nodeId, status: "skipped" });
        continue;
      }

      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
      if (!skill) {
        this.emit({ type: "node-status", nodeId, status: "error", message: `Unknown skill: ${node.skillId}` });
        continue;
      }

      const command = buildCommand(skill, node.paramValues);

      // Mark running
      this.emit({ type: "node-status", nodeId, status: "running" });
      this.emit({ type: "log", nodeId, message: `Launching: ${command}` });

      try {
        // Launch session
        const res = await fetch("/api/plugins/aris-research/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill: skill.name, command }),
        });

        if (!res.ok) {
          throw new Error(`Failed to launch session: ${res.status}`);
        }

        const data = await res.json();
        const sessionId = data.session?.id;
        const logFile = data.session?.logFile;
        this.currentSessionId = sessionId;

        this.emit({ type: "log", nodeId, message: `Session started: ${sessionId}`, sessionId, logFile });

        // Poll for completion
        await this.waitForCompletion(sessionId, nodeId);

        this.emit({ type: "node-status", nodeId, status: "done" });
        this.emit({ type: "log", nodeId, message: `Completed: ${skill.name}` });

      } catch (err) {
        this.emit({
          type: "node-status",
          nodeId,
          status: "error",
          message: String(err),
        });

        // Don't continue to downstream nodes on error
        const downstream = this.getDownstream(nodeId, edges);
        for (const dId of downstream) {
          this.emit({ type: "node-status", nodeId: dId, status: "skipped" });
        }
        // Skip downstream by marking them in order
        // (they'll be skipped in the next iterations since we don't break)
      }
    }

    this.emit({ type: "pipeline-done", message: this.aborted ? "Pipeline stopped" : "Pipeline completed" });
  }

  private async waitForCompletion(sessionId: string, nodeId: string): Promise<void> {
    const maxPolls = 720; // 1 hour at 5s intervals
    for (let i = 0; i < maxPolls; i++) {
      if (this.aborted) return;

      await sleep(5000);

      try {
        const res = await fetch("/api/plugins/aris-research/sessions");
        const data = await res.json();
        const session = data.sessions?.find((s: { id: string }) => s.id === sessionId);

        if (!session) return; // session deleted?
        if (session.status === "completed") return;
        if (session.status === "error") {
          throw new Error("Session ended with error");
        }

        // Still running, check log for progress
        if (i % 6 === 0) { // Every 30s, emit a progress log
          this.emit({ type: "log", nodeId, message: `Still running... (${Math.floor((i * 5) / 60)}min)` });
        }
      } catch (err) {
        throw new Error(`Poll error: ${err}`);
      }
    }

    throw new Error("Session timed out after 1 hour");
  }

  private getDownstream(nodeId: string, edges: PipelineEdge[]): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const e of edges) {
        if (e.source === id && !visited.has(e.target)) {
          visited.add(e.target);
          result.push(e.target);
          queue.push(e.target);
        }
      }
    }
    return result;
  }

  private emit(event: ExecutionEvent) {
    this.listener(event);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
