/**
 * Execution State Persistence
 *
 * Stores and retrieves pipeline execution state for checkpoint/resume capability.
 * Uses the existing ARIS store API with "execution-states" key.
 */

const API = "/api/plugins/aris-research/store";
const STORE_KEY = "execution-states";

/** Persisted execution state for resume capability */
export interface ExecutionState {
  pipelineId: string;
  status: "running" | "completed" | "error" | "paused";
  completedNodes: string[];
  errorNodes: Record<string, string>; // nodeId -> error message
  skippedNodes: string[];
  startedAt: string;
  lastCheckpoint: string;
  totalElapsedMs: number;
  logs: string[];
}

interface ExecutionStatesData {
  states: Record<string, ExecutionState>; // pipelineId -> state
}

const EMPTY: ExecutionStatesData = { states: {} };

async function readAll(): Promise<ExecutionStatesData> {
  try {
    const res = await fetch(`${API}?key=${STORE_KEY}`);
    const envelope = await res.json();
    return envelope.data ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

async function writeAll(data: ExecutionStatesData): Promise<void> {
  try {
    await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: STORE_KEY, data }),
    });
  } catch {
    // silent fail — non-critical persistence
  }
}

/** Save execution state (creates or updates) */
export async function saveExecutionState(state: ExecutionState): Promise<void> {
  const all = await readAll();
  const updated: ExecutionStatesData = {
    states: { ...all.states, [state.pipelineId]: state },
  };
  await writeAll(updated);
}

/** Retrieve execution state for a pipeline */
export async function getExecutionState(pipelineId: string): Promise<ExecutionState | null> {
  const all = await readAll();
  return all.states[pipelineId] ?? null;
}

/** Clear execution state for a pipeline */
export async function clearExecutionState(pipelineId: string): Promise<void> {
  const all = await readAll();
  const { [pipelineId]: _, ...rest } = all.states;
  await writeAll({ states: rest });
}
