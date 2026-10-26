import type { AutoRolloverPolicy, RolloverStatus, Session } from '../protocol/wire'

export function rolloverActive(status: RolloverStatus | null): boolean {
  return status?.state === 'asking' || status?.state === 'waiting' || status?.state === 'ending' || status?.state === 'verifying' || status?.state === 'handed_off' || status?.state === 'confirmed'
}

export function canRollover(session: Pick<Session, 'command' | 'launchCommand'>): boolean {
  const known = (name: string) => name === 'claude' || name === 'codex'
  return session.launchCommand?.[1] !== 'home-worker' && (known(session.command) || known(session.launchCommand?.[0]?.split('/').pop() ?? ''))
}

export function rolloverSeconds(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

export const autoRolloverLimits = [
  ['thresholdPct', 30, 95],
  ['countdownSeconds', 5, 300],
  ['keepOldMinutes', 1, 120],
  ['idleInputSeconds', 10, 1800],
] as const

export function validAutoRolloverPolicy(p: AutoRolloverPolicy): boolean {
  return autoRolloverLimits.every(([key, min, max]) => Number.isInteger(p[key]) && p[key] >= min && p[key] <= max)
}
