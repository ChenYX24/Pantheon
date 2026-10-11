import type { CSSProperties } from 'react'
import { Circle, type LucideIcon } from 'lucide-react'
import type { HomeFieldColor } from '../../protocol/home'
import { optionColor } from '../home/board'

export function StatusPill({ label, color = 'gray', icon: Icon = Circle, state, compact = false }: { label: string; color?: HomeFieldColor; icon?: LucideIcon; state?: string; compact?: boolean }) {
  const tone = optionColor(color)
  return <span className={compact ? 'shell-status-icon' : 'shell-status'} data-state={state} title={label} aria-label={compact ? label : undefined} style={{ '--home-status-color': tone } as CSSProperties}>
    <Icon size={13} aria-hidden="true" className="shrink-0" />{!compact && <span>{label}</span>}
  </span>
}

export function Badge({ count, label }: { count: number; label?: string }) {
  return count > 0 ? <span className="shell-badge" aria-label={label}>{count}</span> : null
}
