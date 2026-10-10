import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOME_RESOURCES_PATH, homeResourceLink, routeFor } from './routes'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('resource routes', () => {
  it('parses only the resource list and valid detail paths, including trailing slashes', () => {
    for (const suffix of ['', '/']) expect(routeFor(HOME_RESOURCES_PATH + suffix)).toEqual({ kind: 'home', resources: true })
    for (const suffix of ['', '/']) expect(routeFor(homeResourceLink('gpu-1.a_b') + suffix)).toEqual({ kind: 'home', resources: true, resourceId: 'gpu-1.a_b' })
    for (const path of ['resources-x', 'resources/a/b', 'resources/A', 'resources/%2f', 'resources/../', `resources/${'a'.repeat(65)}`]) expect(routeFor(`/home/${path}`)).toEqual({ kind: 'panel' })
  })
  it('keeps lists, details and links under the configured mount', async () => {
    vi.resetModules()
    vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/dev/panel' }) })
    const routes = await import('./routes')
    expect(routes.HOME_RESOURCES_PATH).toBe('/dev/panel/home/resources')
    expect(routes.homeResourceLink('api-main')).toBe('/dev/panel/home/resources/api-main')
    expect(routes.routeFor(routes.homeResourceLink('api-main'))).toEqual({ kind: 'home', resources: true, resourceId: 'api-main' })
    expect(routes.routeFor('/home/resources')).toEqual({ kind: 'panel' })
  })
})
