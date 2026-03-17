/**
 * ARIS Research Plugin - Config Store
 *
 * localStorage-based persistence for ARIS configuration and research state.
 */

import type { ArisConfig, ResearchState } from "./types";

const CONFIG_KEY = "scc-aris-config";
const STATE_KEY = "scc-aris-state";

const DEFAULT_CONFIG: ArisConfig = {
  reviewerModel: "claude-sonnet-4-20250514",
  reviewerProvider: "codex-mcp",
  autoProceed: false,
  humanCheckpoint: true,
  maxRounds: 4,
  pilotMaxHours: 2,
  maxTotalGpuHours: 24,
  venue: "ICLR",
};

const DEFAULT_STATE: ResearchState = {
  currentWorkflow: null,
  currentRound: 0,
  maxRounds: 4,
  score: null,
  status: "idle",
  startedAt: null,
  lastUpdate: null,
  outputs: [],
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

/** Get the current ARIS config (merged with defaults) */
export function getArisConfig(): ArisConfig {
  const stored = readJson<Partial<ArisConfig>>(CONFIG_KEY, {});
  return { ...DEFAULT_CONFIG, ...stored };
}

/** Update ARIS config (partial merge) */
export function setArisConfig(config: Partial<ArisConfig>): void {
  const current = getArisConfig();
  writeJson(CONFIG_KEY, { ...current, ...config });
}

/** Get the current research state */
export function getResearchState(): ResearchState {
  return readJson<ResearchState>(STATE_KEY, DEFAULT_STATE);
}

/** Update research state (partial merge) */
export function setResearchState(state: Partial<ResearchState>): void {
  const current = getResearchState();
  writeJson(STATE_KEY, { ...current, ...state, lastUpdate: new Date().toISOString() });
}

/** Reset research state to idle defaults */
export function resetResearchState(): void {
  writeJson(STATE_KEY, DEFAULT_STATE);
}
