import { Circle } from 'lucide-react'
import { t } from '../../i18n'
import type { HomeExecution } from '../../protocol/home'
import { optionColor } from './board'
import { executionState } from './execution'

export function HomeExecutionStatus({ execution }: { execution: HomeExecution | null }) {
  const state = executionState(execution)
  const color = optionColor(state === 'on' ? 'green' : state === 'flagOff' ? 'orange' : 'gray')
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-vp-xs text-ink-2" title={t(`home.exec.status.${state}`)} data-testid="home-execution-status" data-state={state}>
    <Circle size={10} className="shrink-0" aria-hidden="true" style={{ color, fill: state === 'on' ? color : 'none' }} />
    <span>{t(`home.exec.status.${state}`)}</span>
  </span>
}
