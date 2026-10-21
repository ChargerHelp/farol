import { afterAll, describe, expect, it } from 'vitest'
import { analyzeRepo } from '../helpers/analyze.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

const repos: ScenarioRepo[] = []
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
})

/** Same PR (a route added in routes.config.tsx with its lazy loader), with and without routes.extraFiles. */
function scenario(extraFiles: string[] | undefined): ScenarioRepo {
  const s = createScenarioRepo('split-routes')
  repos.push(s)
  const config = JSON.parse(s.repo.read('farol.config.json')) as { routes: Record<string, unknown> }
  if (extraFiles) config.routes.extraFiles = extraFiles
  s.repo.write('farol.config.json', JSON.stringify(config))
  return s
}

describe('route tree split across modules', () => {
  it('reads the table through imported arrays, constants and lazy functions', async () => {
    const { output } = await analyzeRepo(scenario(undefined).repo)
    expect(output.diagnostics.dynamicRoutes).toEqual([])
    expect(output.routes.added).toEqual([{ key: '/ > orders', path: '/orders', entry: 'src/pages/OrdersPage.tsx', hasChildren: false }])
  })

  it('without extraFiles, changing a route module is a change to existing code (conservative default)', async () => {
    const { output } = await analyzeRepo(scenario(undefined).repo)
    expect(output.classification).toBe('touches-existing')
    // The route array of routes.config.tsx changed; routes.modules.ts only gained an export (declaration-level additive).
    expect(output.reasons.filter((r) => r.code === 'existing-file-unreachable').map((r) => r.file)).toEqual(['src/routes/routes.config.tsx'])
    expect(output.reasons.filter((r) => r.code === 'declarations-additive').map((r) => r.file)).toEqual(['src/routes/routes.modules.ts'])
  })

  it('with extraFiles, route modules get the routes rule and an added route is isolated', async () => {
    const { output } = await analyzeRepo(scenario(['src/routes/routes.config.tsx', 'src/routes/routes.modules.ts']).repo)
    expect(output.classification).toBe('isolated')
    expect(output.files.filter((f) => f.role === 'routes').map((f) => [f.path, f.additive])).toEqual([
      ['src/routes/routes.config.tsx', true],
      ['src/routes/routes.modules.ts', true],
    ])
    expect(output.reasons.map((r) => r.code)).toContain('new-file-in-new-route')
  })

  it('with extraFiles, editing an existing route in a route module is still touches-existing', async () => {
    const s = scenario(['src/routes/*.ts', 'src/routes/*.tsx'])
    s.repo.write('src/routes/routes.consts.ts', "export const SEGMENTS = {\n  products: 'catalog',\n  about: 'about',\n  settings: 'settings',\n} as const\n")
    s.repo.commit('rename a segment')
    const { output } = await analyzeRepo(s.repo)
    expect(output.classification).toBe('touches-existing')
    expect(output.reasons.filter((r) => r.code === 'routes-not-additive').map((r) => [r.file, r.detail])).toEqual([
      ['src/routes.tsx', 'route /products (/ > products) was removed'],
      ['src/routes/routes.consts.ts', '1 line(s) removed (line 2 of the base)'],
    ])
    expect(output.routes.affected).toEqual([{ key: '/ > products', path: '/products', hasChildren: false, via: [{ file: 'src/routes.tsx', chain: ['src/routes.tsx'] }] }])
  })
})
