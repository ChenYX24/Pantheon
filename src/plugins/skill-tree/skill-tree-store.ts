/**
 * Skill Tree Store — persistence via SCC store API
 */

import type { SkillTreeState, SkillStatusOverride, CustomSkill, SkillStatus, SkillConfig } from "./types";

const API = "/api/plugins/skill-tree/store";

const EMPTY_STATE: SkillTreeState = {
  overrides: [],
  customSkills: [],
  positions: {},
  collapsedCategories: [],
};

export async function getSkillTreeState(): Promise<SkillTreeState> {
  try {
    const res = await fetch(`${API}?key=state`);
    const envelope = await res.json();
    return envelope.data ? { ...EMPTY_STATE, ...envelope.data } : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveSkillTreeState(state: SkillTreeState): Promise<void> {
  try {
    await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "state", data: state }),
    });
  } catch {
    // silent fail
  }
}

export async function setSkillStatus(
  skillId: string,
  status: SkillStatus,
  notes?: string
): Promise<SkillTreeState> {
  const state = await getSkillTreeState();
  const existing = state.overrides.findIndex((o) => o.skillId === skillId);
  const override: SkillStatusOverride = {
    skillId,
    status,
    notes,
    ...(status === "planned" ? { wantedAt: new Date().toISOString() } : {}),
  };

  const newOverrides =
    existing >= 0
      ? state.overrides.map((o, i) => (i === existing ? override : o))
      : [...state.overrides, override];

  const newState = { ...state, overrides: newOverrides };
  await saveSkillTreeState(newState);
  return newState;
}

export async function removeOverride(skillId: string): Promise<SkillTreeState> {
  const state = await getSkillTreeState();
  const newState = {
    ...state,
    overrides: state.overrides.filter((o) => o.skillId !== skillId),
  };
  await saveSkillTreeState(newState);
  return newState;
}

export async function addCustomSkill(skill: Omit<CustomSkill, "isCustom" | "createdAt">): Promise<SkillTreeState> {
  const state = await getSkillTreeState();
  const custom: CustomSkill = {
    ...skill,
    isCustom: true,
    createdAt: new Date().toISOString(),
  };
  const newState = {
    ...state,
    customSkills: [...state.customSkills, custom],
  };
  await saveSkillTreeState(newState);
  return newState;
}

export async function updateCustomSkill(
  skillId: string,
  updates: Partial<Omit<CustomSkill, "isCustom" | "createdAt" | "id">>
): Promise<SkillTreeState> {
  const state = await getSkillTreeState();
  const newState = {
    ...state,
    customSkills: state.customSkills.map((s) =>
      s.id === skillId ? { ...s, ...updates } : s
    ),
  };
  await saveSkillTreeState(newState);
  return newState;
}

export async function removeCustomSkill(skillId: string): Promise<SkillTreeState> {
  const state = await getSkillTreeState();
  const newState = {
    ...state,
    customSkills: state.customSkills.filter((s) => s.id !== skillId),
    overrides: state.overrides.filter((o) => o.skillId !== skillId),
  };
  await saveSkillTreeState(newState);
  return newState;
}

export async function savePositions(positions: Record<string, { x: number; y: number }>): Promise<void> {
  const state = await getSkillTreeState();
  await saveSkillTreeState({ ...state, positions });
}

export async function getSkillConfig(skillId: string): Promise<SkillConfig> {
  const state = await getSkillTreeState();
  return state.skillConfigs?.[skillId] ?? { params: {} };
}

export async function saveSkillConfig(skillId: string, config: SkillConfig): Promise<SkillTreeState> {
  const state = await getSkillTreeState();
  const newState = {
    ...state,
    skillConfigs: {
      ...state.skillConfigs,
      [skillId]: config,
    },
  };
  await saveSkillTreeState(newState);
  return newState;
}
