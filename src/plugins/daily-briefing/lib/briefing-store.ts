/**
 * Daily Briefing Store (Server-side, file-based)
 *
 * Storage layout:
 *   ~/.claude/ptn-data/daily-briefing/needs.json       — InfoNeed[]
 *   ~/.claude/ptn-data/daily-briefing/items-{date}.json — DailyBriefing
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { InfoNeed, DailyBriefing, BriefingItem, PushConfig } from "../types";

// ---- Paths ----

function dataDir(): string {
  return path.join(os.homedir(), ".claude", "ptn-data", "daily-briefing");
}

function needsPath(): string {
  return path.join(dataDir(), "needs.json");
}

function configPath(): string {
  return path.join(dataDir(), "config.json");
}

function pushConfigPath(): string {
  return path.join(dataDir(), "push-config.json");
}

function itemsPath(date: string): string {
  const safe = date.replace(/[^0-9-]/g, "").slice(0, 10);
  return path.join(dataDir(), `items-${safe}.json`);
}

function ensureDir(): void {
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---- Config ----

export function getConfig(): Record<string, unknown> | null {
  try {
    const fp = configPath();
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

// ---- Needs CRUD ----

export function getNeeds(): InfoNeed[] {
  try {
    const fp = needsPath();
    if (!fs.existsSync(fp)) return [];
    const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveNeeds(needs: InfoNeed[]): void {
  ensureDir();
  fs.writeFileSync(needsPath(), JSON.stringify(needs, null, 2), "utf-8");
}

export function getNeed(id: string): InfoNeed | undefined {
  return getNeeds().find((n) => n.id === id);
}

export function addNeed(need: InfoNeed): InfoNeed[] {
  const needs = getNeeds();
  const updated = [...needs, need];
  saveNeeds(updated);
  return updated;
}

export function updateNeed(
  id: string,
  patch: Partial<Omit<InfoNeed, "id">>,
): InfoNeed[] {
  const needs = getNeeds();
  const updated = needs.map((n) =>
    n.id === id ? { ...n, ...patch } : n,
  );
  saveNeeds(updated);
  return updated;
}

export function deleteNeed(id: string): InfoNeed[] {
  const needs = getNeeds();
  const updated = needs.filter((n) => n.id !== id);
  saveNeeds(updated);
  return updated;
}

// ---- Briefing (daily items) ----

export function getBriefing(date: string): DailyBriefing | null {
  try {
    const fp = itemsPath(date);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

export function saveBriefing(briefing: DailyBriefing): void {
  ensureDir();
  fs.writeFileSync(
    itemsPath(briefing.date),
    JSON.stringify(briefing, null, 2),
    "utf-8",
  );
}

export function updateBriefingItem(
  date: string,
  itemId: string,
  patch: Partial<BriefingItem>,
): DailyBriefing | null {
  const briefing = getBriefing(date);
  if (!briefing) return null;

  const updatedItems = briefing.items.map((item) =>
    item.id === itemId ? { ...item, ...patch } : item,
  );

  const updated: DailyBriefing = { ...briefing, items: updatedItems };
  saveBriefing(updated);
  return updated;
}

// ---- Push Config ----

const DEFAULT_PUSH_CONFIG: PushConfig = {
  enabled: false,
  channels: [],
  format: "summary-and-items",
  maxItems: 10,
  includeLinks: true,
};

export function getPushConfig(): PushConfig {
  try {
    const fp = pushConfigPath();
    if (!fs.existsSync(fp)) return { ...DEFAULT_PUSH_CONFIG };
    const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
    return { ...DEFAULT_PUSH_CONFIG, ...data };
  } catch {
    return { ...DEFAULT_PUSH_CONFIG };
  }
}

export function savePushConfig(config: PushConfig): void {
  ensureDir();
  fs.writeFileSync(pushConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}
