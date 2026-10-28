import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Output } from '../../src/output/schema.js'
import { analyzeScenario, normalizeOutput } from '../helpers/analyze.js'
import { createRepo, createScenarioRepo, FIXTURES_DIR } from '../helpers/repo.js'
import { runCli } from '../helpers/cli.js'

const cleanups: (() => void)[] = []
afterAll(() => {
  for (const c of cleanups) c()
})

/** Expected class and affected entry points per Go scenario (stdlib-only module, net/http routes); full output is golden. */
const SCENARIOS: Record<string, { classification: Output['classification']; affected: string[]; check?: (o: Output) => void }> = {
  // A new route and a new handler method: main() only gains a registration, so nothing that existed changed.
  'g1-new-endpoint': {
    classification: 'isolated',
    affected: [],
    check: (o) => {
      expect(o.routes.added.map((r) => r.key)).toEqual(['GET /brands/count'])
      expect(o.reasons.filter((r) => r.code === 'declarations-additive').map((r) => r.file)).toEqual(['cmd/api/main.go', 'internal/api/handler.go'])
    },
  },
  // displayName runs only behind UserService.Me (interface call resolved to *Users.Me).
  'g2-service-changed': { classification: 'touches-existing', affected: ['GET /me'] },
  // Store.All: GET /brands through BrandService.List, and the worker binary; GET /brands/{id} uses Find only.
  'g3-store-changed': { classification: 'touches-existing', affected: ['GET /brands', 'RUN cmd/worker'] },
  // Comments and formatting change no declaration hash.
  'g4-comments-only': { classification: 'isolated', affected: [], check: (o) => { expect(o.reasons.map((r) => r.code)).toContain('declarations-additive'); } },
  // A field of model.Brand: everything that handles brands; GET /me handles users only.
  'g5-model-field': { classification: 'touches-existing', affected: ['GET /brands', 'GET /brands/{id}', 'RUN cmd/worker'] },
  'g6-go-directive': { classification: 'global', affected: [], check: (o) => { expect(o.reasons.find((r) => r.code === 'manifest-changed')?.detail).toBe('fields changed: go'); } },
  // gin (groups, middlewares, a group passed to a function), echo and gRPC (stub modules through replace): store.Find
  // runs behind net/http GET /brands/{id} and the GetBrand RPC only.
  'g8-frameworks': {
    classification: 'touches-existing',
    affected: ['GET /brands/{id}', 'RPC brandspb.Brands/GetBrand'],
    check: (o) => {
      expect(o.reasons.some((r) => r.code === 'existing-file-modified' && r.detail.includes('2 existing entry point'))).toBe(true)
    },
  },
  // Contracts: writeJSON encodes its argument, so the brand handlers return model.Brand; its json tag name became
  // title, ID became an int, and an omitempty logo was added.
  'g9-contracts': {
    classification: 'touches-existing',
    affected: ['GET /brands', 'GET /brands/{id}', 'RUN cmd/worker'],
    check: (o) => {
      expect(o.contracts?.summary).toEqual({ breaking: 2, dangerous: 0, safe: 0 })
      expect(o.contracts?.entries.find((e) => e.key === 'GET /brands/{id}')?.changes.map((x) => `${x.level} ${x.where}: ${x.detail}`)).toEqual([
        'breaking response.id: type changed from string to int',
        'breaking response.name: field removed',
        'safe response.logo: field added',
        'safe response.title: field added',
      ])
    },
  },
  // GET /me removed; the inline GET /health handler changed.
  'g7-routes-changed': {
    classification: 'touches-existing',
    affected: ['GET /health'],
    check: (o) => { expect(o.reasons.map((r) => r.detail).join('\n')).toContain('entry point GET /me was removed'); },
  },
  // The usual Go layout: a server struct holding its chi router, routes registered in a method. migratePost changed
  // and builds a new migrator, a fmt.Stringer: GET / formats values through fmt.Stringer but never sees a migrator.
  // A constant appended to an iota group changes no other constant: GET /settings (NotMigrated) is not affected.
  'g10-chi-server': {
    classification: 'touches-existing',
    affected: ['POST /repo/migrate', 'RUN cmd/site'],
    check: (o) => {
      expect(o.reasons.find((r) => r.file === 'internal/server/migrator.go')?.detail).toContain('POST /repo/migrate')
      expect(o.reasons.find((r) => r.file === 'internal/server/kinds.go')?.code).toBe('declarations-additive')
    },
  },
}

describe('Go scenarios', () => {
  for (const [scenario, spec] of Object.entries(SCENARIOS)) {
    it(scenario, async () => {
      const { output, cleanup } = await analyzeScenario(scenario)
      cleanups.push(cleanup)
      expect(output.diagnostics.error).toBeNull()
      expect(output.surface).toBe('backend')
      expect(output.classification).toBe(spec.classification)
      expect(output.routes.affected.map((r) => r.key)).toEqual(spec.affected)
      spec.check?.(output)
      const golden = join(FIXTURES_DIR, scenario, 'expected.json')
      const actual = `${JSON.stringify(normalizeOutput(output), null, 2)}\n`
      if (process.env.UPDATE_GOLDEN === '1' || !existsSync(golden)) writeFileSync(golden, actual)
      expect(actual).toBe(readFileSync(golden, 'utf8'))
    }, 60_000)
  }

  it('lists the entry points with routes and what reaches a file with impact', () => {
    const s = createScenarioRepo('g2-service-changed')
    cleanups.push(() => {
      s.repo.cleanup()
    })
    const routes = runCli(['--cwd', s.repo.dir, 'routes', '--ref', s.base])
    expect(routes.code).toBe(0)
    expect((JSON.parse(routes.stdout) as { routes: { key: string }[] }).routes.map((r) => r.key)).toEqual(['GET /brands', 'GET /brands/{id}', 'GET /health', 'GET /me', 'RUN cmd/worker'])
    const impact = runCli(['--cwd', s.repo.dir, 'impact', 'internal/service/users.go', '--ref', s.base])
    expect(impact.code).toBe(0)
    expect((JSON.parse(impact.stdout) as { routes: { key: string }[] }).routes.map((r) => r.key)).toEqual(['GET /me'])
  }, 60_000)

  it('keeps helper outputs between runs, keyed by tree', () => {
    const s = createScenarioRepo('g2-service-changed')
    cleanups.push(() => {
      s.repo.cleanup()
    })
    const cache = join(s.repo.dir, '.cache-test')
    const args = ['--cwd', s.repo.dir, '--verbose', 'analyze', '--base', s.base, '--head', s.head, '--cache-dir', cache]
    const first = runCli(args)
    const second = runCli(args)
    expect(first.code).toBe(0)
    expect(first.stderr).not.toContain('read from the cache')
    expect(second.stderr.match(/read from the cache/g)).toHaveLength(2)
    expect(JSON.parse(second.stdout)).toMatchObject({ classification: (JSON.parse(first.stdout) as { classification: string }).classification })
    expect(runCli([...args, '--no-cache']).stderr).not.toContain('read from the cache')
  }, 60_000)

  it('reads a golangci-lint report from the project directory, and reports one whose paths start at the repository root as a lint error', () => {
    // A Go project in services/api. main.go ends the path of the changed cmd/x/main.go but is a file of the project,
    // so a report naming it is not written from another folder.
    const repo = createRepo()
    cleanups.push(() => {
      repo.cleanup()
    })
    const main = (body: string): string => `package main\n\nfunc main() {\n\t${body}\n}\n`
    repo.write('services/api/farol.config.json', JSON.stringify({ language: 'go', surface: 'backend' }))
    repo.write('services/api/go.mod', 'module example.com/api\n\ngo 1.22\n')
    repo.write('services/api/main.go', main('println("api")'))
    repo.write('services/api/cmd/x/main.go', main('println("x")'))
    const base = repo.commit('base')
    repo.git('checkout', '-q', '-b', 'feature')
    repo.write('services/api/cmd/x/main.go', main('println("x2")'))
    const head = repo.commit('head')
    const lint = (...issues: [string, number][]): Output['signals']['lint'] => {
      const report = join(repo.dir, 'golangci.json')
      writeFileSync(report, JSON.stringify({ Issues: issues.map(([Filename, Line]) => ({ FromLinter: 'errcheck', Text: 'Error return value is not checked', Pos: { Filename, Line } })) }))
      const result = runCli(['--cwd', join(repo.dir, 'services/api'), 'analyze', '--base', base, '--head', head, '--eslint', report, '--no-cache'])
      expect(result.code).toBe(0)
      return (JSON.parse(result.stdout) as Output).signals.lint
    }
    expect(lint(['cmd/x/main.go', 4], ['main.go', 3])).toMatchObject({ status: 'ok', changedLines: { errors: 1, warnings: 0 }, otherLines: { errors: 1, warnings: 0 } })
    expect(lint(['services/api/cmd/x/main.go', 4])).toMatchObject({
      status: 'error',
      message: 'the golangci-lint report path services/api/cmd/x/main.go is not relative to the project directory: run golangci-lint with --path-mode=abs',
    })
  }, 60_000)

  it('reads the routes of a server struct, with local constant prefixes and runtime paths', () => {
    const s = createScenarioRepo('g10-chi-server')
    cleanups.push(() => {
      s.repo.cleanup()
    })
    const routes = runCli(['--cwd', s.repo.dir, 'routes', '--ref', s.base])
    expect(routes.code).toBe(0)
    const table = JSON.parse(routes.stdout) as { routes: { key: string }[]; dynamicRoutes: unknown[] }
    expect(table.dynamicRoutes).toEqual([])
    expect(table.routes.map((r) => r.key).filter((k) => !k.startsWith('RUN ') && !k.startsWith('GET /brands') && k !== 'GET /me' && k !== 'GET /health')).toEqual(['GET /', 'GET /api/actions/runs', 'GET /repo/migrate', 'GET /settings', 'POST /repo/migrate', 'POST {servicePath() + "*"}'])
  }, 60_000)

  it('reads gin, echo and gRPC entry points', () => {
    const s = createScenarioRepo('g8-frameworks')
    cleanups.push(() => {
      s.repo.cleanup()
    })
    const routes = runCli(['--cwd', s.repo.dir, 'routes', '--ref', s.base])
    expect(routes.code).toBe(0)
    const table = JSON.parse(routes.stdout) as { routes: { key: string; modules: string[] }[] }
    expect(table.routes.map((r) => r.key)).toEqual(
      expect.arrayContaining(['GET /v1/brands', 'POST /v1/admin/reindex', 'GET /api/me', 'DELETE /cache', 'RPC brandspb.Brands/GetBrand', 'RPC brandspb.Brands/ListBrands']),
    )
    expect(table.routes.find((r) => r.key === 'POST /v1/admin/reindex')?.modules).toEqual(['internal/web/web.go'])
    expect(table.routes.some((r) => r.key.startsWith('RUN cmd/grpc') || r.key.startsWith('RUN cmd/gin'))).toBe(false)
  }, 60_000)
})
