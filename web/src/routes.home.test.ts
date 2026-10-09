import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOME_PATH, homeProjectLink, homeSelection, legacyHomeRedirect, routeFor } from './routes'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('Stage A.2 project routes', () => {
  it('recognizes exactly one valid project segment, including trailing slash', () => {
    expect(routeFor(`${HOME_PATH}/p/pantheon`)).toEqual({ kind: 'home', projectId: 'pantheon' })
    expect(routeFor(`${HOME_PATH}/p/pantheon/`)).toEqual({ kind: 'home', projectId: 'pantheon' })
    for (const tail of ['', '../x', 'a/b', 'UPPER', '%2F', 'x'.repeat(65)]) expect(routeFor(`${HOME_PATH}/p/${tail}`)).toEqual({ kind: 'panel' })
  })
  it('round-trips tabs, opaque threads, task IDs and report filenames', () => {
    const selection = { projectId: 'pantheon', taskId: 'A2', reportFile: '问题 & reply.md', tab: 'reports' as const, thread: 'thread & 1' }
    const url = new URL(homeProjectLink(selection), 'https://panel.test')
    expect(homeSelection('pantheon', url.search)).toEqual(selection)
    expect(homeSelection('pantheon', '?tab=unknown')).toMatchObject({ tab: 'chat', thread: 'main' })
    expect(homeSelection('pantheon', '?task=../x').taskId).toBeUndefined()
    expect(homeProjectLink({ projectId: 'pantheon' })).toBe(`${HOME_PATH}/p/pantheon`)
  })
  it('redirects legacy project links without losing selections or overview state', () => {
    const redirected = legacyHomeRedirect(HOME_PATH, '?project=pantheon&task=A2&view=table&priority=P1')!
    const url = new URL(redirected, 'https://panel.test')
    expect(url.pathname).toBe(`${HOME_PATH}/p/pantheon`)
    expect(url.searchParams.get('project')).toBeNull()
    expect(url.searchParams.get('tab')).toBe('tasks')
    expect(url.searchParams.get('task')).toBe('A2')
    expect(url.searchParams.get('priority')).toBe('P1')
    expect(legacyHomeRedirect(HOME_PATH, '?project=pantheon&report=x.md')).toContain('tab=reports')
    expect(legacyHomeRedirect(HOME_PATH, '?project=../x')).toBeNull()
    expect(legacyHomeRedirect(`${HOME_PATH}/p/pantheon`, '?project=other')).toBeNull()
  })
  it('uses the configured base path for parsing, building and legacy redirects', async () => {
    vi.resetModules()
    vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev/panel' }) })
    const routes = await import('./routes')
    expect(routes.HOME_PATH).toBe('/dev/panel/home')
    expect(routes.homeProjectLink({ projectId: 'pantheon', taskId: 'A2' })).toBe('/dev/panel/home/p/pantheon?tab=tasks&task=A2')
    expect(routes.routeFor('/home/p/pantheon')).toEqual({ kind: 'panel' })
    expect(routes.routeFor('/dev/panel/home/p/pantheon')).toEqual({ kind: 'home', projectId: 'pantheon' })
    expect(routes.legacyHomeRedirect('/dev/panel/home/', '?project=pantheon')).toBe('/dev/panel/home/p/pantheon?tab=chat')
  })
})
