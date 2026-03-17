/**
 * Pipeline localStorage persistence
 */
import type { Pipeline } from "./types";

const PIPELINES_KEY = "scc-aris-pipelines";
const ACTIVE_KEY = "scc-aris-active-pipeline";

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

export function getPipelines(): Pipeline[] {
  return readJson<Pipeline[]>(PIPELINES_KEY, []);
}

export function getPipeline(id: string): Pipeline | null {
  return getPipelines().find((p) => p.id === id) ?? null;
}

export function savePipeline(pipeline: Pipeline): void {
  const all = getPipelines();
  const idx = all.findIndex((p) => p.id === pipeline.id);
  const updated = { ...pipeline, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    const next = [...all];
    next[idx] = updated;
    writeJson(PIPELINES_KEY, next);
  } else {
    writeJson(PIPELINES_KEY, [...all, updated]);
  }
}

export function deletePipeline(id: string): void {
  writeJson(PIPELINES_KEY, getPipelines().filter((p) => p.id !== id));
  if (getActivePipelineId() === id) setActivePipelineId(null);
}

export function getActivePipelineId(): string | null {
  return readJson<string | null>(ACTIVE_KEY, null);
}

export function setActivePipelineId(id: string | null): void {
  writeJson(ACTIVE_KEY, id);
}
