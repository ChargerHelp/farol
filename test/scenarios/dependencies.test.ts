import { afterAll, describe, expect, it } from 'vitest'
import { analyzeRepo, analyzeScenario } from '../helpers/analyze.js'
import { runCli } from '../helpers/cli.js'
import { createRepo, createScenarioRepo, type TestRepo } from '../helpers/repo.js'
import { loadContext } from '../../src/cli/context.js'
import { runAnalyze } from '../../src/cli/analyze.js'
import { FIXED_DATE } from '../helpers/analyze.js'

const cleanups: (() => void)[] = []
afterAll(() => {
  for (const c of cleanups) c()
})

async function run(scenario: string) {
  const r = await analyzeScenario(scenario)
  cleanups.push(r.cleanup)
  return r.output
}

describe('dependencies', () => {
  it('a major bump or a removed package is critical and makes the PR global', async () => {
    const o = await run('deps-critical')
    expect(o.classification).toBe('global')
    expect(o.files.map((f) => [f.path, f.role])).toEqual([
      ['package-lock.json', 'lockfile'],
      ['package.json', 'manifest'],
    ])
    expect(o.dependencies.summary).toEqual({ critical: 3, major: 2, minor: 1, patch: 1, added: 1, removed: 1 })
    expect(o.dependencies.changes.filter((c) => c.critical).map((c) => [c.name, c.change, c.bump])).toEqual([
      ['lodash', 'removed', null],
      ['react', 'updated', 'major'],
      ['react-dom', 'updated', 'major'],
    ])
    expect(o.dependencies.lockfiles).toEqual(['package-lock.json'])
    expect(o.reasons.filter((r) => r.code === 'dependency-critical').map((r) => r.detail)).toEqual(['lodash removed (was ^4.17.21)', 'react ^18.2.0 → ^19.0.0 (major)', 'react-dom ^18.2.0 → ^19.0.0 (major)'])
  })

  it('patch, minor and added packages are not critical: the PR is not global for them', async () => {
    const o = await run('deps-safe')
    expect(o.classification).toBe('isolated')
    expect(o.dependencies.summary).toEqual({ critical: 0, major: 0, minor: 1, patch: 1, added: 1, removed: 0 })
    expect(o.reasons.map((r) => r.code)).toEqual(['dependency-changed', 'dependency-changed', 'dependency-changed', 'lockfile-changed', 'no-existing-code-touched'])
  })

  it('a lockfile change without manifest changes is global', async () => {
    const o = await run('deps-lockfile-only')
    expect(o.classification).toBe('global')
    expect(o.reasons[0]).toMatchObject({ code: 'lockfile-only-change', file: 'package-lock.json' })
  })

  it('other manifest fields (scripts, engines…) are a global change', async () => {
    const { repo } = createScenarioRepo('deps-safe')
    cleanups.push(() => { repo.cleanup(); })
    const pkg = JSON.parse(repo.read('package.json')) as Record<string, unknown>
    repo.write('package.json', JSON.stringify({ ...pkg, scripts: { build: 'vite build' } }, null, 2))
    repo.commit('scripts')
    const o = (await analyzeRepo(repo)).output
    expect(o.classification).toBe('global')
    expect(o.reasons[0]).toEqual({ code: 'manifest-changed', file: 'package.json', detail: 'fields changed: scripts' })
  })
})

describe('ignore', () => {
  let repo: TestRepo

  it('configuration globs leave files out of every analysis and list them', async () => {
    repo = createScenarioRepo('10-global-css').repo
    cleanups.push(() => { repo.cleanup(); })
    const config = JSON.parse(repo.read('farol.config.json')) as Record<string, unknown>
    repo.write('farol.config.json', JSON.stringify({ ...config, ignore: ['src/styles/**'] }))
    const o = (await analyzeRepo(repo)).output
    expect(o.classification).toBe('isolated')
    expect(o.files).toEqual([])
    expect(o.ignoredFiles).toEqual(['src/styles/global.css'])
  })

  it('--ignore works from the command line, with repo-relative or project-relative globs', () => {
    const s = createScenarioRepo('deps-critical')
    cleanups.push(() => { s.repo.cleanup(); })
    const r = runCli(['--cwd', s.repo.dir, 'analyze', '--base', 'main', '--head', 'feature', '--ignore', 'package.json', '*.json'])
    const o = JSON.parse(r.stdout) as { classification: string; ignoredFiles: string[]; dependencies: { changes: unknown[] } }
    expect(o.ignoredFiles).toEqual(['package-lock.json', 'package.json'])
    expect(o.dependencies.changes).toEqual([])
    expect(o.classification).toBe('isolated')
  })

  it('in a monorepo, the lockfile of another ecosystem above the project is not a dependency of it', async () => {
    const repo = createRepo()
    cleanups.push(() => {
      repo.cleanup()
    })
    repo.write('bun.lock', '{ "lockfileVersion": 1 }\n')
    repo.write('backend/farol.config.json', JSON.stringify({ language: 'python', surface: 'backend', python: { roots: ['.'] } }))
    repo.write('backend/pyproject.toml', '[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n')
    repo.write('backend/app/__init__.py', '')
    repo.write('backend/app/main.py', 'from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/health")\ndef health() -> dict:\n    return {"ok": True}\n')
    repo.commit('base')
    repo.git('checkout', '-q', '-b', 'feature')
    repo.write('bun.lock', '{ "lockfileVersion": 1, "workspaces": {} }\n')
    repo.commit('frontend tooling')
    const ctx = await loadContext({ config: 'farol.config.json', cwd: `${repo.dir}/backend`, verbose: false })
    const { output } = await runAnalyze(ctx, { base: 'main', head: 'feature' }, { now: () => FIXED_DATE, clock: () => 0, env: {} })
    expect(output.files.map((f) => [f.path, f.role])).toEqual([['bun.lock', 'excluded']])
    expect(output.classification).not.toBe('global')
  }, 60_000)
})
