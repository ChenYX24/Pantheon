/**
 * Pipeline Execution Engine
 *
 * Executes ARIS pipeline nodes using the shared BaseExecutor.
 * Each node launches a Claude CLI session via the sessions API.
 * Supports parallel execution and checkpoint/resume.
 */
import type { Pipeline, PipelineNode, PipelineEdge } from "../types";
import { ARIS_SKILLS } from "../skill-data";
import { buildCommand } from "./build-pipeline-commands";
import {
  BaseExecutor,
  sleep,
  type ExecutionEvent,
  type ExecutionListener,
  type BaseExecutorOptions,
} from "@/lib/execution";
import { saveExecutionState, type ExecutionState } from "./execution-state";

// Re-export for backward compatibility
export type { ExecutionEvent, ExecutionListener } from "@/lib/execution";

export interface ExecutorOptions extends BaseExecutorOptions {
  /** Max parallel node executions (default: 2) */
  maxParallel?: number;
  /** Resume from checkpoint — skip nodes already done */
  resumeFrom?: string; // last completed node ID
}

export class PipelineExecutor extends BaseExecutor<PipelineNode, PipelineEdge> {
  private readonly pipelineId: string;
  private currentSessionIds = new Set<string>();
  private startTime = Date.now();

  constructor(pipeline: Pipeline, listener: ExecutionListener, options?: ExecutorOptions) {
    super(pipeline.nodes, pipeline.edges, listener, {
      maxParallel: options?.maxParallel ?? 2,
      resumeFrom: options?.resumeFrom,
    });
    this.pipelineId = pipeline.id;

    // Register checkpoint callback for state persistence
    this.onCheckpoint(async (completedIds, errorIds, skippedIds) => {
      await this.persistCheckpoint(completedIds, errorIds, skippedIds);
    });
  }

  protected async executeNode(node: PipelineNode): Promise<void> {
    const skill = ARIS_SKILLS.find((s) => s.id === node.skillId);
    if (!skill) {
      throw new Error(`Unknown skill: ${node.skillId}`);
    }

    const command = buildCommand(skill, node.paramValues);
    this.emit({ type: "log", nodeId: node.id, message: `Launching: ${command}` });

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
    if (sessionId) this.currentSessionIds.add(sessionId);

    this.emit({
      type: "log",
      nodeId: node.id,
      message: `Session started: ${sessionId}`,
      sessionId,
      logFile,
    });

    // Poll for completion
    await this.waitForCompletion(sessionId, node.id);

    if (sessionId) this.currentSessionIds.delete(sessionId);
    this.emit({ type: "log", nodeId: node.id, message: `Completed: ${skill.name}` });
  }

  private async waitForCompletion(
    sessionId: string,
    nodeId: string
  ): Promise<void> {
    const maxPolls = 720; // 1 hour at 5s intervals
    for (let i = 0; i < maxPolls; i++) {
      if (this.aborted) return;

      await sleep(5000);

      try {
        const res = await fetch("/api/plugins/aris-research/sessions");
        const data = await res.json();
        const session = data.sessions?.find(
          (s: { id: string }) => s.id === sessionId
        );

        if (!session) return; // session deleted?
        if (session.status === "completed") return;
        if (session.status === "error") {
          throw new Error("Session ended with error");
        }

        // Still running, emit progress every 30s
        if (i % 6 === 0) {
          this.emit({
            type: "log",
            nodeId,
            message: `Still running... (${Math.floor((i * 5) / 60)}min)`,
          });
        }
      } catch (err) {
        throw new Error(`Poll error: ${err}`);
      }
    }

    throw new Error("Session timed out after 1 hour");
  }

  private async persistCheckpoint(
    completedIds: string[],
    errorIds: string[],
    skippedIds: string[]
  ): Promise<void> {
    const state: ExecutionState = {
      pipelineId: this.pipelineId,
      status: this.aborted ? "paused" : "running",
      completedNodes: completedIds,
      errorNodes: Object.fromEntries(errorIds.map((id) => [id, "error"])),
      skippedNodes: skippedIds,
      startedAt: new Date(this.startTime).toISOString(),
      lastCheckpoint: new Date().toISOString(),
      totalElapsedMs: Date.now() - this.startTime,
      logs: [],
    };

    try {
      await saveExecutionState(state);
    } catch {
      // Non-critical
    }
  }
}
