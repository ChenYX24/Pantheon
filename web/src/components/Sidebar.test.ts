import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import type { SidebarProps } from './Sidebar'
import type { Project, Session } from '../protocol/wire'

vi.mock('./home/usePanelHomeLinks', () => ({ usePanelHomeLinks: () => new Map() }))

it('puts context only on the session whose id has a reading, including the phone drawer', () => {
  const noop = () => {}
  const sessions: Session[] = ['known', 'unknown'].map((id) => ({
    id, projectId: 'p', tmuxName: `vp_${id}`, title: id, titleSource: 'auto', state: 'done',
    stateSource: 'heuristic', stateChangedAt: 0, pinned: false, sortIndex: null,
    cwd: '/fixture', command: 'codex', cols: 80, rows: 24, createdAt: 0, archivedAt: null,
    archiveNote: '', summary: '', progress: -1, labels: [], launchCommand: ['codex'],
    launchRecorded: true, launchProfileId: '', claudeAccountId: '', restoreOnBoot: false,
    restoredAt: 0, scrollbackAt: 0, exited: false, exitStatus: 0, scratch: false,
  }))
  const props: SidebarProps = {
    projects: [{ id: 'p', name: 'Project', path: '/fixture' } as Project],
    sessions,
    labels: new Map(), live: ['known', 'unknown'], frozen: [], archived: [], selected: 'known',
    expanded: true, overlay: true, touch: true, disconnected: false, projectOrder: 'auto', hasProjectOrder: false,
    stateGuessed: false, hooksInstalled: false, updateAvailable: null,
    context: { known: { used: 62_000, window: 100_000, model: '', source: 'codex-rollout', at: '2026-10-16T00:00:00Z' } },
    rollover: {},
    onToggle: noop, onSelect: noop, onAddProject: noop, onNewSession: noop, onRenameProject: noop,
    onRemoveProject: noop, onArchiveProject: noop, onOpenArchived: noop, onRenameSession: noop,
    onPinSession: noop, onSetSessionState: noop, onKillSession: noop, onRestartSession: noop,
    onReorderProjects: noop, onAutoOrderProjects: noop, onRestoreProjectOrder: noop, onOpenSettings: noop,
    onOpenUpdate: noop, onSkipUpdate: noop,
  }
  const html = renderToStaticMarkup(createElement(Sidebar, props))
  expect(html.match(/data-testid="context-meter"/g)).toHaveLength(1)
  const known = html.indexOf('data-session-id="known"')
  const unknown = html.indexOf('data-session-id="unknown"')
  expect(html.slice(known, unknown)).toContain('62%')
  expect(html.slice(unknown)).not.toContain('data-testid="context-meter"')
})
