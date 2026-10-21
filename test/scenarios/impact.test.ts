import { afterAll, describe, expect, it } from 'vitest'
import { runCli } from '../helpers/cli.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

interface Impact {
  file: string
  inGraph: boolean
  routes: { key: string; path: string; via: string[] }[]
  dynamicRoutes: unknown[]
}

const repos: ScenarioRepo[] = []
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
})

function impact(scenario: string, file: string, ref: 'base' | 'head' = 'head'): Impact {
  const s = createScenarioRepo(scenario)
  repos.push(s)
  const result = runCli(['--cwd', s.repo.dir, 'impact', file, '--ref', s[ref]])
  expect(result.stderr).toBe('')
  expect(result.code).toBe(0)
  return JSON.parse(result.stdout) as Impact
}

describe('impact (scenarios 14, 15, 16)', () => {
  it('14: a change in Card reaches only routes that import Card, even through the shared barrel', () => {
    const r = impact('14-barrel-precision', 'src/components/Card.tsx')
    expect(r.inGraph).toBe(true)
    expect(r.dynamicRoutes).toEqual([])
    expect(r.routes).toEqual([
      { key: '/ > (index)', path: '/', via: ['src/pages/HomePage.tsx', 'src/components/Card.tsx'] },
      { key: '/ > products', path: '/products', via: ['src/pages/ProductsPage.tsx', 'src/components/Card.tsx'] },
    ])
  })

  it('14: the barrel itself reaches every route that imports through it', () => {
    const r = impact('14-barrel-precision', 'src/components/index.ts')
    expect(r.routes.map((x) => x.key)).toEqual(['/', '/ > (index)', '/ > about', '/ > products', '/ > settings'])
    expect(r.routes.find((x) => x.key === '/ > about')?.via).toEqual(['src/pages/AboutPage.tsx', 'src/components/index.ts'])
  })

  it('15: reach follows the @/ alias and the lazy route import', () => {
    const r = impact('15-alias-and-lazy', 'src/lib/format.ts')
    expect(r.routes).toEqual([
      { key: '/ > products', path: '/products', via: ['src/pages/ProductsPage.tsx', 'src/lib/format.ts'] },
      { key: '/ > settings', path: '/settings', via: ['src/pages/SettingsPage.tsx', 'src/lib/format.ts'] },
    ])
  })

  it('16: routes that only import types from the file are not reached', () => {
    const r = impact('16-import-type-only', 'src/types/product.ts')
    expect(r.routes).toEqual([{ key: '/ > (index)', path: '/', via: ['src/pages/HomePage.tsx', 'src/types/product.ts'] }])
  })

  it('layouts reach every child route; files outside the graph reach nothing', () => {
    const r = impact('14-barrel-precision', 'src/layouts/AppLayout.tsx', 'base')
    expect(r.routes.map((x) => [x.key, x.via])).toEqual([
      ['/', ['src/layouts/AppLayout.tsx']],
      ['/ > (index)', ['src/layouts/AppLayout.tsx']],
      ['/ > about', ['src/layouts/AppLayout.tsx']],
      ['/ > products', ['src/layouts/AppLayout.tsx']],
      ['/ > settings', ['src/layouts/AppLayout.tsx']],
    ])
    const css = impact('14-barrel-precision', 'src/pages/products.css', 'base')
    expect(css.routes.map((x) => x.key)).toEqual(['/ > products'])
    const mock = impact('14-barrel-precision', 'src/mocks/handlers.ts', 'base')
    expect(mock.routes).toEqual([])
  })
})
