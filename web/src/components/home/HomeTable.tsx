import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Filter, Plus, Settings2 } from 'lucide-react'
import { t } from '../../i18n'
import { homeApi, type HomeFields, type HomeFieldSettings, type HomePatchTask, type HomeProject, type HomeTaskRow, type HomeTodo } from '../../protocol/home'
import { homeProjectLink, panelOpeningSession } from '../../routes'
import { Markdown } from '../panels/Rendered'
import { safeText } from '../text'
import { changeHomeTaskFields, confirmHomeStatus } from './actions'
import { filterProjects, filterTasks, groupProjects, groupTasks, HOME_GROUPS, HOME_SORTS, optionFor, sortProjects, sortTasks, viewFromSearch, type HomeViewState } from './board'
import { HomeTime } from './HomeCard'
import { HomeDialog } from './HomeDialog'
import { HomeField } from './HomeField'
import { HomeFieldsDialog } from './HomeFieldsDialog'
import { NewTask } from './HomeNewTask'
import { useHomeMutation } from './useHomeMutation'

export interface HomeTableProps {
  projects: HomeProject[]
  tasks: HomeTaskRow[]
  todos: HomeTodo[]
  settings: HomeFieldSettings | null
  state: HomeViewState
  onState: (state: HomeViewState) => void
  onChanged: () => Promise<unknown> | void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
  projectId?: string
  target?: string
  returnSearch?: string
}

export function HomeTable({ projects, tasks, todos, settings, state, onState, onChanged, onNavigate, projectId, target, returnSearch }: HomeTableProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createProject, setCreateProject] = useState(projectId ?? projects[0]?.id ?? '')
  const { busy, run } = useHomeMutation(onChanged)
  const root = useRef<HTMLElement>(null)
  const fields = settings?.fields
  const kind = projectId ? 'tasks' : state.table
  const effective = { ...state, project: projectId ?? state.project }
  const taskGroups = groupTasks(sortTasks(filterTasks(tasks, effective), state.sort), state.group)
  const projectGroups = groupProjects(sortProjects(filterProjects(projects, effective), state.sort), state.group)
  const selectedTask = tasks.find((row) => row.id === target && (!projectId || row.projectId === projectId))
  const patch = (row: HomeTaskRow, changes: Omit<HomePatchTask, 'rev'>) => run(() => changeHomeTaskFields(row.projectId, row, changes))
  const meta = (row: HomeProject, changes: Partial<HomeProject['meta']>) => run(() => homeApi.patchMeta(row.id, { ...changes, rev: row.metaRev }))

  useEffect(() => {
    if (target) root.current?.querySelector<HTMLElement>('[data-home-task-detail]')?.scrollIntoView({ block: 'nearest' })
  }, [target, selectedTask?.id])

  const groupLabel = (value: string) => {
    const options = state.group === 'status' ? fields?.task.status.options : state.group === 'priority' ? fields?.[kind === 'tasks' ? 'task' : 'project'].priority.options : state.group === 'tags' ? kind === 'tasks' ? fields?.task.tags.options : fields?.project.labels.options : state.group === 'stage' && kind === 'projects' ? fields?.project.phase.options : undefined
    return value ? safeText(optionFor(value, options).label || value) : t('home.groupEmpty')
  }
  const taskCells = (row: HomeTaskRow): ReactNode[] => [
    <a className="vp-control" href={homeProjectLink({ projectId: row.projectId, taskId: row.id }, returnSearch)} onClick={onNavigate}>{safeText(row.projectId)}</a>,
    <div><a className="text-vp-xs text-ink-2 hover:text-accent" href={homeProjectLink({ projectId: row.projectId, taskId: row.id }, returnSearch)} onClick={onNavigate}>{safeText(row.id)}</a><div><HomeField label={t('home.table.title')} value={row.title} required disabled={busy} onSave={(value) => patch(row, { title: String(value) })} /></div></div>,
    <HomeField label={t('home.status')} value={row.status} options={fields?.task.status.options} required disabled={busy || !fields} onSave={(value) => patch(row, { status: value as HomeTaskRow['status'] })} />,
    <HomeField label={t('home.table.priority')} value={row.priority} options={fields?.task.priority.options} disabled={busy || !fields} onSave={(value) => patch(row, { priority: String(value) })} />,
    <HomeField label={t('home.table.tags')} value={row.tags} options={fields?.task.tags.options} disabled={busy || !fields} onSave={(value) => patch(row, { tags: value as string[] })} />,
    <HomeField label={t('home.table.stage')} value={row.stage} disabled={busy} onSave={(value) => patch(row, { stage: String(value) })} />,
    <HomeField label={t('home.table.owner')} value={row.owner} disabled={busy} onSave={(value) => patch(row, { owner: String(value) })} />,
    <HomeField label={t('home.primary')} value={row.primary} disabled={busy} onSave={(value) => patch(row, { primary: String(value) })} />,
    <HomeField label={t('home.table.due')} value={row.due} type="date" disabled={busy} onSave={(value) => patch(row, { due: String(value) })} />,
    <HomeTime at={row.updated} />,
  ]
  const projectCells = (row: HomeProject): ReactNode[] => [
    <a className="vp-control" href={homeProjectLink({ projectId: row.id }, returnSearch)} onClick={onNavigate}>{safeText(row.id)}</a>,
    safeText(row.goal) || t('home.noGoal'),
    <HomeField label={t('home.table.labels')} value={row.meta.labels} options={fields?.project.labels.options} disabled={busy || !fields} onSave={(value) => meta(row, { labels: value as string[] })} />,
    <HomeField label={t('home.table.priority')} value={row.meta.priority} options={fields?.project.priority.options} disabled={busy || !fields} onSave={(value) => meta(row, { priority: String(value) })} />,
    <HomeField label={t('home.table.phase')} value={row.meta.phase} options={fields?.project.phase.options} disabled={busy || !fields} onSave={(value) => meta(row, { phase: String(value) })} />,
    <HomeField label={t('home.table.owner')} value={row.meta.owner} disabled={busy} onSave={(value) => meta(row, { owner: String(value) })} />,
    row.taskCounts.total,
    todos.filter((todo) => todo.projectId === row.id).length,
    <HomeTime at={row.updatedAt} />,
  ]
  const headers = kind === 'tasks'
    ? [t('home.table.project'), t('home.table.title'), t('home.status'), t('home.table.priority'), t('home.table.tags'), t('home.table.stage'), t('home.table.owner'), t('home.primary'), t('home.table.due'), t('home.table.updated')]
    : [t('home.table.project'), t('home.table.goal'), t('home.table.labels'), t('home.table.priority'), t('home.table.phase'), t('home.table.owner'), t('home.table.taskCount'), t('home.table.todoCount'), t('home.table.updated')]
  const groups = kind === 'tasks' ? taskGroups.map((group) => ({ ...group, rows: group.rows.map((row) => ({ key: `${row.projectId}:${row.id}`, cells: taskCells(row) })) })) : projectGroups.map((group) => ({ ...group, rows: group.rows.map((row) => ({ key: row.id, cells: projectCells(row) })) }))
  const filterProps = { state, onState, projects, fields, projectId, kind }

  return <section ref={root} className="@container min-w-0 space-y-3" aria-label={t(kind === 'tasks' ? 'home.table.tasks' : 'home.table.projects')}>
    <div className="flex flex-wrap items-center gap-2">
      {!projectId && <div className="vp-segmented" role="group" aria-label={t('home.view.table')}>{(['tasks', 'projects'] as const).map((value) => <button type="button" key={value} className="vp-tab px-3 text-vp-sm" data-active={kind === value} aria-pressed={kind === value} onClick={() => onState({ ...state, table: value })}>{t(`home.table.${value}`)}</button>)}</div>}
      <button type="button" className="vp-control @3xl:hidden" onClick={() => setFiltersOpen(true)}><Filter size={15} />{t('home.filter')} / {t('home.group')}</button>
      <button type="button" className="vp-control" disabled={busy || !projects.length} onClick={() => { setCreateProject(projectId ?? (state.project || projects[0]?.id || '')); setCreating(true) }}><Plus size={15} />{t('home.newTask')}</button>
      <button type="button" className="vp-control" disabled={!settings} onClick={() => setFieldsOpen(true)}><Settings2 size={15} />{t('home.fields')}</button>
    </div>
    <div className="hidden @3xl:block"><HomeFilters {...filterProps} /></div>
    {!groups.length && <p className="rounded-vp border border-hairline bg-surface p-4 text-ink-2">{t('home.noMatches')}</p>}
    <div className="hidden max-h-[65dvh] min-w-0 max-w-full overflow-auto rounded-vp border border-hairline @3xl:block">
      <table className="home-table"><thead><tr>{headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>
        {groups.map((group) => <Fragment key={group.value}>{state.group !== 'none' && <tr><td colSpan={headers.length} className="bg-surface-2 font-semibold">{t('home.groupCount', { group: groupLabel(group.value), count: group.rows.length })}</td></tr>}{group.rows.map((row) => <tr key={row.key} data-testid="home-table-row">{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</Fragment>)}
      </tbody></table>
    </div>
    <div className="space-y-4 @3xl:hidden">{groups.map((group) => <section key={group.value} className="space-y-3">
      {state.group !== 'none' && <h3 className="font-semibold">{t('home.groupCount', { group: groupLabel(group.value), count: group.rows.length })}</h3>}
      {group.rows.map((row) => <article key={row.key} className="min-w-0 rounded-vp border border-hairline bg-surface p-3" data-testid="home-table-card"><dl className="grid min-w-0 grid-cols-[minmax(0,5rem)_minmax(0,1fr)] items-start gap-x-2 gap-y-1">{row.cells.map((cell, index) => <Fragment key={index}><dt className="py-1 text-vp-xs text-ink-2">{headers[index]}</dt><dd className="min-w-0 text-vp-sm">{cell}</dd></Fragment>)}</dl></article>)}
    </section>)}</div>
    {selectedTask && <article data-home-task-detail className="scroll-mt-4 rounded-vp border border-accent bg-surface p-3">
      <h3 className="font-semibold">{safeText(selectedTask.id)} · {safeText(selectedTask.title)}</h3>
      <div className="mt-3 grid gap-2 text-vp-sm">
        <label>{t('home.secondary')}<HomeField label={t('home.secondary')} value={selectedTask.secondary} onSave={(value) => patch(selectedTask, { secondary: String(value) })} /></label>
        <label>{t('home.dependencies')}<HomeField label={t('home.dependencies')} value={selectedTask.dependsOn.join(', ')} onSave={(value) => patch(selectedTask, { dependsOn: String(value).split(/[,，]/).map((id) => id.trim()).filter(Boolean) })} /></label>
        <label>{t('home.blockedReason')}<HomeField label={t('home.blockedReason')} value={selectedTask.blockedReason} onSave={(value) => patch(selectedTask, { blockedReason: String(value) })} /></label>
        <p>{t('home.handoffs', { count: selectedTask.handoffs })}</p>
        {selectedTask.sessionStatus === 'rollover_due' && <p>{t('home.todo.session_rollover')}</p>}
        {selectedTask.session && <a className="vp-control justify-self-start" href={panelOpeningSession(selectedTask.session)}>{t('home.openTerminal')}</a>}
      </div>
      <div className="min-w-0 overflow-hidden"><Markdown text={selectedTask.body} /></div>
    </article>}
    {target && !selectedTask && <p role="status">{t('home.taskMissing')}</p>}
    {filtersOpen && <HomeDialog title={t('home.filter')} onClose={() => setFiltersOpen(false)}><HomeFilters {...filterProps} /></HomeDialog>}
    {fieldsOpen && settings && <HomeFieldsDialog settings={settings} onClose={() => setFieldsOpen(false)} onChanged={onChanged} />}
    {creating && <HomeDialog title={t('home.newTask')} onClose={() => { if (!busy) setCreating(false) }}>
      {!projectId && <label className="mb-3 block text-vp-sm">{t('home.chooseProject')}<select className="home-input mt-1" value={createProject} disabled={busy} onChange={(event) => setCreateProject(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{safeText(project.id)}</option>)}</select></label>}
      <NewTask busy={busy} onCreate={(task) => run(async () => {
        if (!createProject) return false
        if ((task.status === 'done' || task.status === 'cancelled') && !await confirmHomeStatus(task.title, task.status)) return false
        await homeApi.createTask(createProject, task)
        setCreating(false)
      })} />
    </HomeDialog>}
  </section>
}

function HomeFilters({ state, onState, projects, fields, projectId, kind }: {
  state: HomeViewState
  onState: (state: HomeViewState) => void
  projects: HomeProject[]
  fields?: HomeFields
  projectId?: string
  kind: string
}) {
  return <div className="@container rounded-vp border border-hairline bg-surface p-3"><div className="grid min-w-0 gap-3 @lg:grid-cols-2 @3xl:grid-cols-4">
    {!projectId && <label className="min-w-0 text-vp-xs">{t('home.table.project')}<select className="home-input mt-1" value={state.project} onChange={(event) => onState({ ...state, project: event.target.value })}><option value="">{t('home.filterAll')}</option>{projects.map((project) => <option key={project.id} value={project.id}>{safeText(project.id)}</option>)}</select></label>}
    {kind === 'tasks' && <div className="min-w-0 text-vp-xs">{t('home.status')}<div><HomeField label={t('home.status')} value={state.status} options={fields?.task.status.options ?? []} onSave={async (value) => { onState({ ...state, status: value as string[] }); return true }} /></div></div>}
    <div className="min-w-0 text-vp-xs">{t('home.table.priority')}<div><HomeField label={t('home.table.priority')} value={state.priority} options={fields?.[kind === 'tasks' ? 'task' : 'project'].priority.options ?? []} onSave={async (value) => { onState({ ...state, priority: value as string[] }); return true }} /></div></div>
    <div className="min-w-0 text-vp-xs">{t('home.table.tags')}<div><HomeField label={t('home.table.tags')} value={state.tags} options={(kind === 'tasks' ? fields?.task.tags.options : fields?.project.labels.options) ?? []} onSave={async (value) => { onState({ ...state, tags: value as string[] }); return true }} /></div></div>
    <label className="min-w-0 text-vp-xs">{t('home.table.owner')}<input className="home-input mt-1" value={state.owner} onChange={(event) => onState({ ...state, owner: event.target.value })} /></label>
    <label className="min-w-0 text-vp-xs">{t('home.group')}<select className="home-input mt-1" value={state.group} onChange={(event) => onState({ ...state, group: event.target.value as HomeViewState['group'] })}>{HOME_GROUPS.map((group) => <option key={group} value={group}>{t(`home.group.${group}`)}</option>)}</select></label>
    <label className="min-w-0 text-vp-xs">{t('home.sort')}<select className="home-input mt-1" value={state.sort} onChange={(event) => onState({ ...state, sort: event.target.value as HomeViewState['sort'] })}>{HOME_SORTS.filter((sort) => kind === 'tasks' || sort !== 'due').map((sort) => <option key={sort} value={sort}>{t(`home.sort.${sort}`)}</option>)}</select></label>
    <button type="button" className="vp-control self-end justify-self-start" onClick={() => onState({ ...viewFromSearch(''), view: state.view, table: state.table, all: state.all, q: state.q })}>{t('home.resetFilters')}</button>
  </div></div>
}
