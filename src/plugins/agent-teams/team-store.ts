/**
 * Agent Teams Plugin - Team Store (v4.0)
 *
 * File-based persistence via API with in-memory cache.
 * Async API functions + deprecated sync fallbacks for backward compatibility.
 */

import type { AgentTeam, TeamMember, TeamRun } from "./types";

const API = "/api/plugins/agent-teams/store";

// ---- ID generators ----

function generateId(): string {
  return `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateMemberId(): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- In-memory cache ----

let teamsCache: AgentTeam[] | null = null;
let runsCache: TeamRun[] | null = null;

function invalidateTeamsCache() {
  teamsCache = null;
}

function invalidateRunsCache() {
  runsCache = null;
}

// ---- API helpers ----

async function fetchKey<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}?key=${key}`);
    if (!res.ok) return null;
    const envelope = await res.json();
    return envelope.data ?? null;
  } catch (err) {
    console.error(`[TeamStore] Failed to fetch key "${key}":`, err);
    return null;
  }
}

async function putKey(key: string, data: unknown): Promise<void> {
  try {
    await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, data }),
    });
  } catch (err) {
    console.error(`[TeamStore] Failed to save key "${key}":`, err);
  }
}

// ---- Async API-based functions ----

export async function getTeamsAsync(): Promise<AgentTeam[]> {
  if (teamsCache !== null) return teamsCache;
  const data = await fetchKey<AgentTeam[]>("teams");
  teamsCache = data ?? [];
  return teamsCache;
}

export async function saveTeamsAsync(teams: AgentTeam[]): Promise<void> {
  await putKey("teams", teams);
  teamsCache = teams;
}

export async function getTeamAsync(id: string): Promise<AgentTeam | undefined> {
  const teams = await getTeamsAsync();
  return teams.find((t) => t.id === id);
}

export async function createTeamAsync(
  team: Omit<AgentTeam, "id" | "created_at" | "updated_at">
): Promise<AgentTeam> {
  const teams = await getTeamsAsync();
  const now = new Date().toISOString();
  const newTeam: AgentTeam = {
    ...team,
    id: generateId(),
    members: team.members.map((m) => ({ ...m, id: m.id || generateMemberId() })),
    created_at: now,
    updated_at: now,
  };
  await saveTeamsAsync([...teams, newTeam]);
  return newTeam;
}

export async function updateTeamAsync(
  id: string,
  updates: Partial<AgentTeam>
): Promise<AgentTeam | null> {
  const teams = await getTeamsAsync();
  const idx = teams.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated: AgentTeam = {
    ...teams[idx],
    ...updates,
    id, // preserve id
    updated_at: new Date().toISOString(),
  };
  const next = teams.map((t, i) => (i === idx ? updated : t));
  await saveTeamsAsync(next);
  return updated;
}

export async function deleteTeamAsync(id: string): Promise<boolean> {
  const teams = await getTeamsAsync();
  const filtered = teams.filter((t) => t.id !== id);
  if (filtered.length === teams.length) return false;
  await saveTeamsAsync(filtered);
  return true;
}

export async function cloneTeamAsync(
  id: string,
  newName: string
): Promise<AgentTeam | null> {
  const team = await getTeamAsync(id);
  if (!team) return null;
  return createTeamAsync({
    name: newName,
    description: team.description,
    icon: team.icon,
    workflow: team.workflow,
    members: team.members.map((m) => ({ ...m, id: generateMemberId() })),
    tags: [...team.tags],
    isPreset: false,
    presetId: team.isPreset ? team.id : team.presetId,
    canvas: team.canvas,
  });
}

// ---- Runs management ----

export async function getTeamRuns(teamId: string): Promise<TeamRun[]> {
  if (runsCache === null) {
    const data = await fetchKey<TeamRun[]>("runs");
    runsCache = data ?? [];
  }
  return runsCache.filter((r) => r.teamId === teamId);
}

export async function saveTeamRun(run: TeamRun): Promise<void> {
  if (runsCache === null) {
    const data = await fetchKey<TeamRun[]>("runs");
    runsCache = data ?? [];
  }
  const idx = runsCache.findIndex((r) => r.id === run.id);
  const next = idx >= 0
    ? runsCache.map((r, i) => (i === idx ? run : r))
    : [...runsCache, run];
  await putKey("runs", next);
  runsCache = next;
}

// ---- Async member helpers ----

export async function addMemberAsync(
  teamId: string,
  member: Omit<TeamMember, "id">
): Promise<TeamMember | null> {
  const team = await getTeamAsync(teamId);
  if (!team) return null;
  const newMember: TeamMember = { ...member, id: generateMemberId() };
  await updateTeamAsync(teamId, { members: [...team.members, newMember] });
  return newMember;
}

export async function updateMemberAsync(
  teamId: string,
  memberId: string,
  updates: Partial<TeamMember>
): Promise<boolean> {
  const team = await getTeamAsync(teamId);
  if (!team) return false;
  const members = team.members.map((m) =>
    m.id === memberId ? { ...m, ...updates, id: memberId } : m
  );
  await updateTeamAsync(teamId, { members });
  return true;
}

export async function removeMemberAsync(
  teamId: string,
  memberId: string
): Promise<boolean> {
  const team = await getTeamAsync(teamId);
  if (!team) return false;
  const members = team.members.filter((m) => m.id !== memberId);
  await updateTeamAsync(teamId, { members });
  return true;
}

// ---- Deprecated sync functions (backward compatibility) ----
// These read from in-memory cache populated by the first async call.
// They return empty data during SSR or before the first fetch.

/** @deprecated Use getTeamsAsync() instead */
export function getTeams(): AgentTeam[] {
  return teamsCache ?? [];
}

/** @deprecated Use getTeamAsync() instead */
export function getTeam(id: string): AgentTeam | undefined {
  return (teamsCache ?? []).find((t) => t.id === id);
}

/** @deprecated Use createTeamAsync() instead */
export function createTeam(
  team: Omit<AgentTeam, "id" | "created_at" | "updated_at">
): AgentTeam {
  const now = new Date().toISOString();
  const newTeam: AgentTeam = {
    ...team,
    id: generateId(),
    members: team.members.map((m) => ({ ...m, id: m.id || generateMemberId() })),
    created_at: now,
    updated_at: now,
  };
  // Fire-and-forget save
  const teams = [...(teamsCache ?? []), newTeam];
  teamsCache = teams;
  putKey("teams", teams);
  return newTeam;
}

/** @deprecated Use updateTeamAsync() instead */
export function updateTeam(id: string, updates: Partial<AgentTeam>): AgentTeam | null {
  const teams = teamsCache ?? [];
  const idx = teams.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated: AgentTeam = {
    ...teams[idx],
    ...updates,
    id,
    updated_at: new Date().toISOString(),
  };
  const next = teams.map((t, i) => (i === idx ? updated : t));
  teamsCache = next;
  putKey("teams", next);
  return updated;
}

/** @deprecated Use deleteTeamAsync() instead */
export function deleteTeam(id: string): boolean {
  const teams = teamsCache ?? [];
  const filtered = teams.filter((t) => t.id !== id);
  if (filtered.length === teams.length) return false;
  teamsCache = filtered;
  putKey("teams", filtered);
  return true;
}

/** @deprecated Use cloneTeamAsync() instead */
export function cloneTeam(id: string, newName: string): AgentTeam | null {
  const team = getTeam(id);
  if (!team) return null;
  return createTeam({
    name: newName,
    description: team.description,
    icon: team.icon,
    workflow: team.workflow,
    members: team.members.map((m) => ({ ...m, id: generateMemberId() })),
    tags: [...team.tags],
    isPreset: false,
    presetId: team.isPreset ? team.id : team.presetId,
    canvas: team.canvas,
  });
}

/** @deprecated Use addMemberAsync() instead */
export function addMember(teamId: string, member: Omit<TeamMember, "id">): TeamMember | null {
  const team = getTeam(teamId);
  if (!team) return null;
  const newMember: TeamMember = { ...member, id: generateMemberId() };
  updateTeam(teamId, { members: [...team.members, newMember] });
  return newMember;
}

/** @deprecated Use updateMemberAsync() instead */
export function updateMember(
  teamId: string,
  memberId: string,
  updates: Partial<TeamMember>
): boolean {
  const team = getTeam(teamId);
  if (!team) return false;
  const members = team.members.map((m) =>
    m.id === memberId ? { ...m, ...updates, id: memberId } : m
  );
  updateTeam(teamId, { members });
  return true;
}

/** @deprecated Use removeMemberAsync() instead */
export function removeMember(teamId: string, memberId: string): boolean {
  const team = getTeam(teamId);
  if (!team) return false;
  const members = team.members.filter((m) => m.id !== memberId);
  updateTeam(teamId, { members });
  return true;
}
