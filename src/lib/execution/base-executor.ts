/**
 * Base Execution Engine
 *
 * Generic execution abstraction shared by ARIS pipelines and Agent Teams.
 * Provides topological sort, downstream detection, parallel execution,
 * and checkpoint/resume capability.
 */

export type NodeStatus = "idle" | "queued" | "running" | "done" | "error" | "skipped";

export interface ExecutionEvent {
  type: "node-status" | "log" | "pipeline-done" | "pipeline-error";
  nodeId?: string;
  status?: NodeStatus;
  message?: string;
  sessionId?: string;
  logFile?: string;
}

export type ExecutionListener = (event: ExecutionEvent) => void;

/**
 * Topological sort using Kahn's algorithm.
 * Returns node IDs in dependency-respecting order.
 */
export function topoSort<T extends { id: string }>(
  nodes: T[],
  edges: { source: string; target: string }[]
): string[] {
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

/**
 * Compute topological levels (for parallel execution).
 * Nodes at the same level have no dependencies on each other.
 */
export function topoLevels<T extends { id: string }>(
  nodes: T[],
  edges: { source: string; target: string }[]
): string[][] {
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

  let queue: string[] = [];
  for (const [id, d] of inDeg) {
    if (d === 0) queue.push(id);
  }

  const levels: string[][] = [];
  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const next of adj.get(id) ?? []) {
        const d = (inDeg.get(next) ?? 1) - 1;
        inDeg.set(next, d);
        if (d === 0) nextQueue.push(next);
      }
    }
    queue = nextQueue;
  }
  return levels;
}

/**
 * Get all downstream node IDs from a given node (BFS).
 */
export function getDownstream(
  nodeId: string,
  edges: { source: string; target: string }[]
): string[] {
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

export interface BaseExecutorOptions {
  /** Max nodes to run in parallel per level. Default: 1 (sequential). */
  maxParallel?: number;
  /** Resume from checkpoint — skip nodes already completed */
  resumeFrom?: string; // last completed node ID
}

/** Callback invoked after each node completes (for checkpoint persistence) */
export type CheckpointCallback = (completedIds: string[], errorIds: string[], skippedIds: string[]) => Promise<void>;

/**
 * Abstract base executor.
 * Subclasses implement `executeNode()` for domain-specific logic.
 */
export abstract class BaseExecutor<
  TNode extends { id: string },
  TEdge extends { source: string; target: string },
> {
  protected readonly nodes: TNode[];
  protected readonly edges: TEdge[];
  protected readonly listener: ExecutionListener;
  protected readonly maxParallel: number;
  protected readonly resumeFrom: string | undefined;
  protected aborted = false;
  private checkpointCallback: CheckpointCallback | null = null;

  constructor(
    nodes: TNode[],
    edges: TEdge[],
    listener: ExecutionListener,
    options?: BaseExecutorOptions
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.listener = listener;
    this.maxParallel = options?.maxParallel ?? 1;
    this.resumeFrom = options?.resumeFrom;
  }

  abort(): void {
    this.aborted = true;
  }

  /** Register a callback for checkpoint persistence after each node */
  onCheckpoint(cb: CheckpointCallback): void {
    this.checkpointCallback = cb;
  }

  async run(): Promise<void> {
    const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    const levels = topoLevels(this.nodes, this.edges);
    const allIds = levels.flat();

    const completedSet = new Set<string>();
    const errorSet = new Set<string>();
    const skippedSet = new Set<string>();

    // Handle resume: mark nodes up to resumeFrom as already done
    let resumeReached = !this.resumeFrom; // true if no resume needed
    if (this.resumeFrom) {
      for (const id of topoSort(this.nodes, this.edges)) {
        completedSet.add(id);
        if (id === this.resumeFrom) {
          resumeReached = true;
          break;
        }
      }
    }

    // Set initial statuses
    for (const id of allIds) {
      if (completedSet.has(id)) {
        this.emit({ type: "node-status", nodeId: id, status: "done" });
      } else {
        this.emit({ type: "node-status", nodeId: id, status: "queued" });
      }
    }

    if (completedSet.size > 0) {
      this.emit({
        type: "log",
        message: `Resumed: skipping ${completedSet.size} previously completed node(s)`,
      });
    }

    for (const level of levels) {
      // Filter out already completed or skipped nodes
      const runnableIds = level.filter(
        (id) => !completedSet.has(id) && !skippedSet.has(id)
      );

      if (runnableIds.length === 0) continue;

      if (this.maxParallel <= 1) {
        // Sequential within level
        for (const nodeId of runnableIds) {
          await this.runSingleNode(nodeId, nodeMap, completedSet, errorSet, skippedSet);
          await this.fireCheckpoint(completedSet, errorSet, skippedSet);
        }
      } else {
        // Parallel within level, limited by maxParallel
        for (let i = 0; i < runnableIds.length; i += this.maxParallel) {
          const batch = runnableIds.slice(i, i + this.maxParallel);
          await Promise.all(
            batch.map((nodeId) =>
              this.runSingleNode(nodeId, nodeMap, completedSet, errorSet, skippedSet)
            )
          );
          await this.fireCheckpoint(completedSet, errorSet, skippedSet);
        }
      }
    }

    // If aborted, mark remaining as skipped
    if (this.aborted) {
      for (const id of allIds) {
        if (!completedSet.has(id) && !errorSet.has(id) && !skippedSet.has(id)) {
          skippedSet.add(id);
          this.emit({ type: "node-status", nodeId: id, status: "skipped" });
        }
      }
    }

    await this.fireCheckpoint(completedSet, errorSet, skippedSet);

    const hasErrors = errorSet.size > 0;
    const message = this.aborted
      ? "Pipeline stopped"
      : hasErrors
        ? `Pipeline completed with ${errorSet.size} error(s)`
        : "Pipeline completed";

    this.emit({ type: "pipeline-done", message });
  }

  /** Subclasses implement this to execute a single node. */
  protected abstract executeNode(node: TNode): Promise<void>;

  protected emit(event: ExecutionEvent): void {
    this.listener(event);
  }

  private async runSingleNode(
    nodeId: string,
    nodeMap: Map<string, TNode>,
    completedSet: Set<string>,
    errorSet: Set<string>,
    skippedSet: Set<string>
  ): Promise<void> {
    if (this.aborted) {
      this.emit({ type: "node-status", nodeId, status: "skipped" });
      skippedSet.add(nodeId);
      return;
    }

    const node = nodeMap.get(nodeId);
    if (!node) return;

    this.emit({ type: "node-status", nodeId, status: "running" });

    try {
      await this.executeNode(node);
      completedSet.add(nodeId);
      this.emit({ type: "node-status", nodeId, status: "done" });
    } catch (err) {
      errorSet.add(nodeId);
      this.emit({
        type: "node-status",
        nodeId,
        status: "error",
        message: String(err),
      });

      // Skip all downstream nodes
      const downstream = getDownstream(nodeId, this.edges);
      for (const dId of downstream) {
        if (!completedSet.has(dId) && !errorSet.has(dId)) {
          skippedSet.add(dId);
          this.emit({ type: "node-status", nodeId: dId, status: "skipped" });
        }
      }
    }
  }

  private async fireCheckpoint(
    completedSet: Set<string>,
    errorSet: Set<string>,
    skippedSet: Set<string>
  ): Promise<void> {
    if (!this.checkpointCallback) return;
    try {
      await this.checkpointCallback(
        [...completedSet],
        [...errorSet],
        [...skippedSet]
      );
    } catch {
      // Non-critical — don't fail pipeline for checkpoint persistence
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
