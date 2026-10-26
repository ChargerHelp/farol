import { cpSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { FIXED_DATE, normalizeOutput } from '../helpers/analyze.js'
import { BASE_APP_DIR, createRepo, type TestRepo } from '../helpers/repo.js'
import { loadContext } from '../../src/cli/context.js'
import { runAnalyze } from '../../src/cli/analyze.js'
import { OutputSchema, type Output } from '../../src/output/schema.js'

const cleanups: (() => void)[] = []
afterAll(() => {
  for (const c of cleanups) c()
})

/** A workspace package that ships only its build output (`dist/`, git-ignored), as tsup or tsc emit it. */
const DIST_ONLY = {
  name: 'lib',
  version: '1.0.0',
  type: 'module',
  exports: {
    '.': { import: './dist/index.mjs', types: './dist/index.d.mts' },
    './node': { import: './dist/node.mjs' },
  },
}

interface WorkspaceShape {
  /** `packages/lib/package.json`. */
  lib?: Record<string, unknown>
  /** Extra workspace dependencies of `apps/a`. */
  extraDependencies?: Record<string, string>
  /** Extra compiler options of `apps/a/tsconfig.json`. */
  compilerOptions?: Record<string, unknown>
  /** Extra imports of the about page (one statement per line). */
  extraImports?: string[]
  /** Import of the settings page. */
  settingsImport?: string
  /** More files of the base commit. */
  setup?: (repo: TestRepo) => void
}

/**
 * A pnpm workspace: app `apps/a` (the base app) depends on `lib` (`packages/lib`) with `workspace:*`. The about page
 * imports `lib`, the settings page imports `lib/node`. Nothing is installed or built: no `node_modules`, no `dist/`.
 */
function workspace(change: (repo: TestRepo) => void, shape: WorkspaceShape = {}): TestRepo {
  const repo = createRepo()
  cleanups.push(() => { repo.cleanup(); })
  cpSync(BASE_APP_DIR, join(repo.dir, 'apps/a'), { recursive: true })
  repo.write('.gitignore', 'node_modules\ndist\n')
  repo.write('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n")
  const app = JSON.parse(repo.read('apps/a/package.json')) as { dependencies: Record<string, string> }
  repo.write('apps/a/package.json', JSON.stringify({ ...app, dependencies: { ...app.dependencies, lib: 'workspace:*', ...shape.extraDependencies } }, null, 2))
  const tsconfig = JSON.parse(repo.read('apps/a/tsconfig.json')) as { compilerOptions: Record<string, unknown> }
  repo.write('apps/a/tsconfig.json', JSON.stringify({ ...tsconfig, compilerOptions: { ...tsconfig.compilerOptions, ...shape.compilerOptions } }, null, 2))
  repo.write('packages/lib/package.json', JSON.stringify(shape.lib ?? DIST_ONLY, null, 2))
  repo.write('packages/lib/src/index.ts', "export { thing } from './thing.js'\n")
  repo.write('packages/lib/src/thing.ts', "export const thing = 'thing'\n")
  repo.write('packages/lib/src/node.ts', "export const node = 'node'\n")
  repo.write(
    'apps/a/src/pages/AboutPage.tsx',
    [
      "import { Button } from '@/components'",
      "import { thing } from 'lib'",
      ...(shape.extraImports ?? []),
      '',
      'export function AboutPage() {',
      '  return (',
      '    <div>',
      '      <p>About us {thing}</p>',
      '      <Button label="Contact" />',
      '    </div>',
      '  )',
      '}',
      '',
    ].join('\n'),
  )
  repo.write(
    'apps/a/src/pages/SettingsPage.tsx',
    [
      "import { Button } from '@/components'",
      shape.settingsImport ?? "import { node } from 'lib/node'",
      '',
      'export function Component() {',
      '  return (',
      '    <div>',
      '      <p>Settings {node}</p>',
      '      <Button label="Save" />',
      '    </div>',
      '  )',
      '}',
      '',
    ].join('\n'),
  )
  shape.setup?.(repo)
  repo.commit('base')
  repo.git('checkout', '-q', '-b', 'feature')
  change(repo)
  repo.commit('feature')
  return repo
}

const changeThing = (r: TestRepo): void => { r.write('packages/lib/src/thing.ts', "export const thing = 'other thing'\n") }
const changeNode = (r: TestRepo): void => { r.write('packages/lib/src/node.ts', "export const node = 'other node'\n") }
const changeAboutPage = (r: TestRepo): void => { r.write('apps/a/src/pages/AboutPage.tsx', r.read('apps/a/src/pages/AboutPage.tsx').replace('About us', 'About')) }

async function analyzeApp(repo: TestRepo): Promise<Output> {
  const ctx = await loadContext({ config: 'farol.config.json', cwd: `${repo.dir}/apps/a`, verbose: false })
  const { output } = await runAnalyze(ctx, { base: 'main', head: 'feature' }, { now: () => FIXED_DATE, clock: () => 0, env: {} })
  OutputSchema.parse(output)
  return output
}

const affectedPaths = (o: Output): string[] => o.routes.affected.map((r) => r.path)
const unresolved = (o: Output): [string | undefined, string][] => o.reasons.filter((r) => r.code === 'unresolved-import').map((r) => [r.file, r.detail])
const PACKAGE_UNRESOLVED: [string, string] = ['packages/lib/src/thing.ts', 'cannot resolve "lib" (workspace package packages/lib), imported at apps/a/src/pages/AboutPage.tsx line 2']

describe('workspace packages that export only their build output', () => {
  it('a change in the package source reaches the pages that import the package', async () => {
    const o = await analyzeApp(workspace(changeThing))
    expect(o.classification).toBe('touches-existing')
    expect(affectedPaths(o)).toEqual(['/about'])
  }, 60_000)

  it('reaches the pages through an export that has no types target', async () => {
    const o = await analyzeApp(workspace(changeNode))
    expect(o.classification).toBe('touches-existing')
    expect(affectedPaths(o)).toEqual(['/settings'])
  }, 60_000)

  it('gives the same result whatever is installed, built or edited on the disk', async () => {
    const clean = await analyzeApp(workspace(changeThing))
    const repo = workspace(changeThing)
    mkdirSync(join(repo.dir, 'apps/a/node_modules'), { recursive: true })
    symlinkSync('../../../packages/lib', join(repo.dir, 'apps/a/node_modules/lib'))
    repo.write('packages/lib/dist/index.d.mts', 'export declare const somethingElse: string\n')
    repo.write('packages/lib/dist/index.mjs', "export const somethingElse = 'x'\n")
    repo.write('packages/lib/package.json', JSON.stringify({ ...DIST_ONLY, exports: { '.': { types: './dist/missing.d.mts' } } }, null, 2))
    const dirty = await analyzeApp(repo)
    expect(dirty.classification).toBe('touches-existing')
    expect(affectedPaths(dirty)).toEqual(['/about'])
    expect(normalizeOutput(dirty)).toEqual(normalizeOutput(clean))
  }, 60_000)

  it('reaches the pages through the types field of a package without exports', async () => {
    const lib = { name: 'lib', version: '1.0.0', main: './dist/index.js', types: './dist/index.d.ts' }
    const o = await analyzeApp(workspace(changeThing, { lib, settingsImport: "import { thing as node } from 'lib'" }))
    expect(o.classification).toBe('touches-existing')
    expect(affectedPaths(o)).toEqual(['/about', '/settings'])
  }, 60_000)

  describe('a package whose build output has no source counterpart is unknown', () => {
    const lib = { ...DIST_ONLY, exports: { '.': { import: './build/index.mjs', types: './build/index.d.mts' } } }

    it('when only the package source changes', async () => {
      const o = await analyzeApp(workspace(changeThing, { lib }))
      expect(o.classification).toBe('unknown')
      expect(unresolved(o)).toEqual([PACKAGE_UNRESOLVED])
    }, 60_000)

    it('when the importing page changes', async () => {
      const o = await analyzeApp(workspace(changeAboutPage, { lib }))
      expect(o.classification).toBe('unknown')
      expect(unresolved(o)).toEqual([['apps/a/src/pages/AboutPage.tsx', 'line 2: cannot resolve "lib"']])
    }, 60_000)
  })

  it('a workspace dependency that matches no package of the repository is unknown', async () => {
    const o = await analyzeApp(workspace(changeAboutPage, { extraDependencies: { gone: 'workspace:*' }, extraImports: ["import 'gone'"] }))
    expect(o.classification).toBe('unknown')
    expect(unresolved(o)).toEqual([['apps/a/src/pages/AboutPage.tsx', 'line 3: cannot resolve "gone"']])
  }, 60_000)

  it('a package name two folders share is unknown when one of them changes', async () => {
    const setup = (r: TestRepo): void => { r.write('templates/lib/package.json', JSON.stringify({ name: 'lib', version: '0.0.0' })) }
    const o = await analyzeApp(workspace(changeThing, { setup }))
    expect(o.classification).toBe('unknown')
    expect(unresolved(o)).toEqual([PACKAGE_UNRESOLVED])
  }, 60_000)

  it('with preserveSymlinks a package source change is unknown, never isolated', async () => {
    const o = await analyzeApp(workspace(changeThing, { compilerOptions: { preserveSymlinks: true } }))
    expect(o.classification).toBe('unknown')
    expect(unresolved(o)).toEqual([PACKAGE_UNRESOLVED])
  }, 60_000)
})
