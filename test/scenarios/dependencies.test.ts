import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { analyzeRepo, analyzeScenario } from '../helpers/analyze.js'
import { runCli } from '../helpers/cli.js'
import { BASE_APP_DIR, createRepo, createScenarioRepo, type TestRepo } from '../helpers/repo.js'
import { loadContext } from '../../src/cli/context.js'
import { runAnalyze } from '../../src/cli/analyze.js'
import { mergeScore } from '../../src/report/merge-score.js'
import { computeVerdict } from '../../src/report/verdict.js'
import type { Output } from '../../src/output/schema.js'
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

describe('monorepo lockfile', () => {
  const LOCK = "lockfileVersion: '9.0'\n\nimporters:\n  apps/a: {}\n  apps/b: {}\n"

  /** A pnpm monorepo with two frontend apps sharing the root lockfile; `change` edits the feature branch. */
  function monorepo(change: (repo: TestRepo) => void, setup: (repo: TestRepo) => void = () => undefined): TestRepo {
    const repo = createRepo()
    cleanups.push(() => { repo.cleanup(); })
    for (const app of ['apps/a', 'apps/b']) cpSync(BASE_APP_DIR, join(repo.dir, app), { recursive: true })
    repo.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n")
    repo.write('pnpm-lock.yaml', LOCK)
    setup(repo)
    repo.commit('base')
    repo.git('checkout', '-q', '-b', 'feature')
    change(repo)
    repo.commit('feature')
    return repo
  }

  function addDependency(repo: TestRepo, manifest: string, name: string): void {
    const pkg = JSON.parse(repo.read(manifest)) as { dependencies: Record<string, string> }
    repo.write(manifest, JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, [name]: '^1.0.0' } }, null, 2))
  }

  /** App b gains a dependency; the shared lockfile follows. */
  const bumpAppB = (r: TestRepo): void => {
    addDependency(r, 'apps/b/package.json', 'left-pad')
    r.write('pnpm-lock.yaml', `${LOCK}  # left-pad\n`)
  }
  const relockOnly = (r: TestRepo): void => { r.write('pnpm-lock.yaml', `${LOCK}  # resolved again\n`) }
  const codes = (o: Output): string[] => o.reasons.map((r) => r.code)

  async function analyzeApp(repo: TestRepo, app: string): Promise<Output> {
    const ctx = await loadContext({ config: 'farol.config.json', cwd: `${repo.dir}/${app}`, verbose: false })
    return (await runAnalyze(ctx, { base: 'main', head: 'feature' }, { now: () => FIXED_DATE, clock: () => 0, env: {} })).output
  }

  it("a lockfile change caused by another project's dependency change touches existing code, not everything", async () => {
    const a = await analyzeApp(monorepo(bumpAppB), 'apps/a')
    expect(a.classification).toBe('touches-existing')
    expect(codes(a)).not.toContain('lockfile-only-change')
    const elsewhere = a.reasons.find((r) => r.code === 'lockfile-changed-elsewhere')
    expect(elsewhere?.file).toBe('pnpm-lock.yaml')
    expect(elsewhere?.detail).toContain('apps/b/package.json')
  }, 60_000)

  it('the project whose manifest changed sees its own dependency change with the lockfile', async () => {
    const b = await analyzeApp(monorepo(bumpAppB), 'apps/b')
    expect(codes(b)).toEqual(expect.arrayContaining(['dependency-changed', 'lockfile-changed']))
    expect(codes(b)).not.toContain('lockfile-changed-elsewhere')
  }, 60_000)

  it("adds a small weight to the merge risk score and asks for a look at the lockfile, not at existing code", async () => {
    const a = await analyzeApp(monorepo(bumpAppB), 'apps/a')
    expect(mergeScore(a).items.filter((i) => i.file === 'pnpm-lock.yaml').map((i) => [i.kind, i.weight])).toEqual([['dependency', 0.05]])
    const verdict = computeVerdict(a)
    expect(verdict.level).toBe('quick')
    expect(verdict.reasons.join('\n')).toContain('apps/b/package.json')
    expect(verdict.reasons.join('\n')).not.toContain('existing code changed')
  }, 60_000)

  it("a lockfile change with dependency changes in the project's own manifest follows them, whatever else changed", async () => {
    const repo = monorepo((r) => {
      addDependency(r, 'apps/a/package.json', 'left-pad')
      addDependency(r, 'apps/b/package.json', 'is-odd')
      r.write('pnpm-lock.yaml', `${LOCK}  # left-pad, is-odd\n`)
    })
    const a = await analyzeApp(repo, 'apps/a')
    expect(codes(a)).toContain('lockfile-changed')
    expect(codes(a)).not.toContain('lockfile-changed-elsewhere')
  }, 60_000)

  it('names every other manifest that explains the lockfile change, in path order', async () => {
    const repo = monorepo(
      (r) => {
        addDependency(r, 'apps/c/package.json', 'is-odd')
        addDependency(r, 'apps/b/package.json', 'left-pad')
        r.write('pnpm-lock.yaml', `${LOCK}  # left-pad, is-odd\n`)
      },
      (r) => { cpSync(BASE_APP_DIR, join(r.dir, 'apps/c'), { recursive: true }) },
    )
    const a = await analyzeApp(repo, 'apps/a')
    expect(a.reasons.find((r) => r.code === 'lockfile-changed-elsewhere')?.detail).toContain('apps/b/package.json, apps/c/package.json')
  }, 60_000)

  it('a lockfile change without a dependency change in any manifest stays global', async () => {
    const a = await analyzeApp(monorepo(relockOnly), 'apps/a')
    expect(a.classification).toBe('global')
    expect(a.reasons[0]).toMatchObject({ code: 'lockfile-only-change', file: 'pnpm-lock.yaml' })
  }, 60_000)

  it('another manifest that changed without a dependency change does not explain the lockfile change', async () => {
    const repo = monorepo((r) => {
      const pkg = JSON.parse(r.read('apps/b/package.json')) as Record<string, unknown>
      r.write('apps/b/package.json', JSON.stringify({ ...pkg, scripts: { build: 'vite build' } }, null, 2))
      relockOnly(r)
    })
    const a = await analyzeApp(repo, 'apps/a')
    expect(a.classification).toBe('global')
    expect(codes(a)).toContain('lockfile-only-change')
    expect(codes(a)).not.toContain('lockfile-changed-elsewhere')
  }, 60_000)

  it('another manifest that cannot be read does not explain the lockfile change, and is named', async () => {
    const repo = monorepo((r) => {
      r.write('apps/b/package.json', '{ "dependencies": ')
      relockOnly(r)
    })
    const a = await analyzeApp(repo, 'apps/a')
    expect(a.classification).toBe('global')
    expect(a.reasons.find((r) => r.code === 'lockfile-only-change')?.detail).toContain('could not read apps/b/package.json')
  }, 60_000)

  it("the project's own manifest that cannot be read is not explained away by another project's change", async () => {
    const repo = monorepo((r) => {
      bumpAppB(r)
      r.write('apps/a/package.json', '{ "dependencies": ')
    })
    const a = await analyzeApp(repo, 'apps/a')
    expect(codes(a)).toContain('lockfile-only-change')
    expect(codes(a)).not.toContain('lockfile-changed-elsewhere')
  }, 60_000)

  it('the manifest of a workspace package the project imports is a manifest of the project', async () => {
    const repo = monorepo(
      (r) => {
        r.write('packages/lib/package.json', JSON.stringify({ name: 'lib', dependencies: { 'left-pad': '^1.0.0' } }, null, 2))
        r.write('pnpm-lock.yaml', `${LOCK}  # left-pad\n`)
      },
      (r) => {
        r.write('packages/lib/package.json', JSON.stringify({ name: 'lib', dependencies: {} }, null, 2))
        r.write('packages/lib/src/format.ts', 'export const format = (s: string): string => s.trim()\n')
        r.write('apps/a/src/lib/format.ts', "export { format } from '../../../../packages/lib/src/format'\n")
      },
    )
    const a = await analyzeApp(repo, 'apps/a')
    expect(a.files).toContainEqual(expect.objectContaining({ path: 'packages/lib/package.json', role: 'manifest' }))
    expect(a.reasons).toContainEqual(expect.objectContaining({ code: 'dependency-changed', file: 'packages/lib/package.json' }))
    expect(codes(a)).toContain('lockfile-changed')
    expect(codes(a)).not.toContain('lockfile-changed-elsewhere')
  }, 60_000)
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
