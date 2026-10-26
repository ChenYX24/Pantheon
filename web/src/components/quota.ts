import type { AgentQuota, QuotaLimit } from '../protocol/wire'

/** "5h", "7d": the windows both agents have, named the way their own UIs do. */
export function windowLabel(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/**
 * The windows still current at `nowSec`.
 *
 * A window past its reset is the agent's last word about a window that has
 * since started over. Drawing it would say 96% of a five-hour window that is
 * in fact empty, so it is left out here rather than on the server, where the
 * snapshot would then change by itself whenever a clock crossed a line.
 */
export function currentLimits(quota: AgentQuota | undefined, nowSec: number): QuotaLimit[] {
  return (quota?.limits ?? []).filter((l) => l.resetsAt === 0 || l.resetsAt > nowSec)
}
