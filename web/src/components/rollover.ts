import type { RolloverStatus, Session } from '../protocol/wire'

export function rolloverActive(status: RolloverStatus | null): boolean {
  return status?.state === 'asking' || status?.state === 'waiting' || status?.state === 'ending'
}

export function canRollover(session: Pick<Session, 'command' | 'launchCommand'>): boolean {
  const known = (name: string) => name === 'claude' || name === 'codex'
  return session.launchCommand?.[1] !== 'home-worker' && (known(session.command) || known(session.launchCommand?.[0]?.split('/').pop() ?? ''))
}
