import { t, type Key } from '../../i18n'
import type { HomeAutonomy, HomeExecution, HomeExecutionMeta, HomeFieldColor, HomePatchMeta, HomeProject, HomeRun, HomeRunState, HomeRunTime, HomeTask } from '../../protocol/home'
import { safeText } from '../text'

export function executionState(execution: HomeExecution | null): 'unknown' | 'flagOff' | 'switchedOff' | 'on' {
  if (!execution) return 'unknown'
  if (execution.flag !== 'allow') return 'flagOff'
  return execution.enabled ? 'on' : 'switchedOff'
}

export function activeRun(state: HomeRunState): boolean {
  return state === 'running' || state === 'reviewing'
}

export function taskRunReason(task: HomeTask, project: HomeProject | undefined, execution: HomeExecution | null, tasks: readonly HomeTask[]): string {
  if (task.status !== 'planned') return t('home.exec.reason.notPlanned')
  const state = executionState(execution)
  if (state !== 'on') return t(`home.exec.reason.${state}`)
  if (!project?.path || !project.pathExists) return t('home.exec.reason.checkout')
  if (project.activeRun || execution?.active.some((run) => run.projectId === project.id && activeRun(run.state))) return t('home.exec.reason.projectBusy')
  if (execution && execution.active.filter((run) => activeRun(run.state)).length >= execution.maxRuns) return t('home.exec.reason.capacity', { count: execution.maxRuns })
  const unfinished = task.dependsOn.filter((id) => !tasks.some((dependency) => dependency.id === id && dependency.status === 'done'))
  if (unfinished.length) return t('home.exec.reason.dependencies', { tasks: safeText(unfinished.join(', ')) })
  // Manual starts deliberately bypass autonomy. Git validity and claim races
  // remain server checks: neither has a field in the project snapshot.
  return ''
}

type RunIcon = 'running' | 'reviewing' | 'accepted' | 'rejected' | 'blocked' | 'failed' | 'stopped' | 'merged'
export function runChip(state: HomeRunState): { color: HomeFieldColor; icon: RunIcon; label: Key } {
  const colors: Record<HomeRunState, HomeFieldColor> = { running: 'blue', reviewing: 'purple', accepted: 'green', rejected: 'orange', blocked: 'yellow', failed: 'red', stopped: 'gray', merged: 'teal' }
  return { color: colors[state], icon: state, label: `home.exec.state.${state}` }
}

function runTime(value: HomeRunTime): number | null {
  const time = typeof value === 'number' ? value * 1000 : Date.parse(value)
  return Number.isFinite(time) && time > 0 ? time : null
}

export function runSeconds(run: Pick<HomeRun, 'startedAt' | 'finishedAt' | 'state'>, now: number): number | null {
  const start = runTime(run.startedAt)
  const end = runTime(run.finishedAt) ?? (activeRun(run.state) ? now : null)
  if (start === null || end === null || !Number.isFinite(end)) return null
  return Math.max(0, Math.floor((end - start) / 1000))
}

export function runDuration(run: Pick<HomeRun, 'startedAt' | 'finishedAt' | 'state'>, now: number): string {
  const seconds = runSeconds(run, now)
  if (seconds === null) return '—'
  if (seconds < 60) return t('home.exec.duration.seconds', { seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('home.exec.duration.minutes', { minutes, seconds: seconds % 60 })
  return t('home.exec.duration.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
}

export interface HomeAutonomyDraft {
  rev: string
  originalAutonomy: HomeAutonomy
  autonomy: HomeAutonomy
  approvedStages: string[]
  autoMerge: boolean
  maxAttempts: string
  attemptMinutes: string
}

export function autonomyDraft(meta: Partial<HomeExecutionMeta>, rev: string): HomeAutonomyDraft {
  return {
    rev, originalAutonomy: meta.autonomy ?? 'off', autonomy: meta.autonomy ?? 'off',
    approvedStages: [...(meta.approvedStages ?? [])], autoMerge: meta.autoMerge ?? false,
    maxAttempts: String(meta.maxAttempts ?? 2), attemptMinutes: String(meta.attemptMinutes ?? 30),
  }
}

export function taskStages(tasks: readonly HomeTask[]): string[] {
  return [...new Set(tasks.map((task) => task.stage).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function toggleApprovedStage(stages: readonly string[], stage: string): string[] {
  return stages.includes(stage) ? stages.filter((value) => value !== stage) : [...stages, stage]
}

export function autonomyError(draft: HomeAutonomyDraft): string {
  const integer = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max
  if (!integer(draft.maxAttempts, 1, 3)) return t('home.exec.attemptsRange')
  if (!integer(draft.attemptMinutes, 5, 120)) return t('home.exec.minutesRange')
  return ''
}

export function autonomyPatch(draft: HomeAutonomyDraft): HomePatchMeta | null {
  if (autonomyError(draft)) return null
  return {
    rev: draft.rev, autonomy: draft.autonomy, approvedStages: [...draft.approvedStages], autoMerge: draft.autoMerge,
    maxAttempts: Number(draft.maxAttempts), attemptMinutes: Number(draft.attemptMinutes),
  }
}
