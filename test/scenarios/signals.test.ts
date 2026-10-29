import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Output } from '../../src/output/schema.js'
import { analyzeRepo, normalizeOutput } from '../helpers/analyze.js'
import { createScenarioRepo, FIXTURES_DIR, type ScenarioRepo } from '../helpers/repo.js'

const repos: ScenarioRepo[] = []
const tmp = mkdtempSync(join(tmpdir(), 'farol-reports-'))
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
  rmSync(tmp, { recursive: true, force: true })
})

/** Copies a hand-written report, replacing <root> with the temporary repository path. */
function report(scenario: string, name: string, root: string): string {
  const target = join(tmp, `${scenario}-${name}`)
  writeFileSync(target, readFileSync(join(FIXTURES_DIR, scenario, 'reports', name), 'utf8').replaceAll('<root>', root))
  return target
}

function golden(scenario: string, file: string, output: Output): void {
  const path = join(FIXTURES_DIR, scenario, file)
  const actual = `${JSON.stringify(normalizeOutput(output), null, 2)}\n`
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(path)) writeFileSync(path, actual)
  expect(actual).toBe(readFileSync(path, 'utf8'))
}

/** `root` replaces <root> in the reports (default: the temporary repository; another path is another checkout). */
async function run(scenario: string, reports: { coverage?: string; eslint?: string } | 'none', root?: string): Promise<Output> {
  const s = createScenarioRepo(scenario)
  repos.push(s)
  const at = root ?? s.repo.dir
  const options = reports === 'none' ? {} : { coverage: reports.coverage && report(scenario, reports.coverage, at), eslint: reports.eslint && report(scenario, reports.eslint, at) }
  return (await analyzeRepo(s.repo, Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)))).output
}

describe('signals', () => {
  it('partial coverage: exact counts and uncovered ranges; a changed file missing from the report is fully uncovered', async () => {
    const o = await run('signals-coverage-lint', { coverage: 'coverage-final.json', eslint: 'eslint.json' })
    expect(o.signals.coverage).toEqual({
      status: 'ok',
      files: [
        { path: 'src/lib/discount.ts', changedExecutableLines: 3, coveredLines: 0, uncovered: [{ start: 1, end: 3 }], missingFromReport: true },
        { path: 'src/lib/format.ts', changedExecutableLines: 6, coveredLines: 4, uncovered: [{ start: 7, end: 7 }, { start: 14, end: 14 }], missingFromReport: false },
      ],
      total: { changedExecutableLines: 9, coveredLines: 4 },
      ignoredFiles: [],
    })
    golden('signals-coverage-lint', 'expected.json', o)
  })

  it('ESLint: only findings on changed lines count; the rest is context', async () => {
    const o = await run('signals-coverage-lint', { eslint: 'eslint.json' })
    expect(o.signals.lint).toEqual({
      status: 'ok',
      changedLines: { errors: 1, warnings: 1 },
      otherLines: { errors: 1, warnings: 1 },
      findings: [
        { path: 'src/lib/format.ts', line: 9, rule: 'no-magic-numbers', severity: 'error', message: 'No magic number: 100.' },
        { path: 'src/lib/format.ts', line: 14, rule: 'no-nested-ternary', severity: 'warning', message: 'Do not nest ternary expressions.' },
      ],
      omittedFindings: 0,
    })
    expect(o.signals.coverage.status).toBe('not-provided')
  })

  it('reports written in another checkout (a container at /src) are an error naming a path, not ok or missing', async () => {
    const o = await run('signals-coverage-lint', { coverage: 'coverage-final.json', eslint: 'eslint.json' }, '/src')
    expect(o.signals.lint.status).toBe('error')
    expect(o.signals.lint.message).toMatch(/^the ESLint report names no file in the repository .+ \(first path: \/src\/src\/lib\/format\.ts\): write the report in the same checkout as farol$/)
    expect(o.signals.coverage.status).toBe('error')
    expect(o.signals.coverage.message).toMatch(/^the coverage report names no file in the repository .+ \(first path: \/src\/src\/[^)]+\): write the report in the same checkout as farol$/)
  })

  it('Biome (GitLab reporter): only findings on changed lines count; security findings come from farol only', async () => {
    const o = await run('signals-biome', { eslint: 'biome.json' })
    expect(o.signals.lint).toEqual({
      status: 'ok',
      changedLines: { errors: 2, warnings: 3 },
      otherLines: { errors: 1, warnings: 0 },
      findings: [
        { path: 'src/seed/findings.ts', line: 3, rule: 'lint/correctness/noUnusedVariables', severity: 'error', message: 'This variable unused is unused.' },
        { path: 'src/seed/findings.ts', line: 7, rule: 'lint/security/noGlobalEval', severity: 'error', message: 'eval() exposes to security risks and performance issues.' },
        { path: 'src/seed/findings.ts', line: 4, rule: 'lint/style/noParameterAssign', severity: 'warning', message: 'Assigning a function parameter is confusing.' },
        { path: 'src/seed/findings.ts', line: 8, rule: 'lint/suspicious/noDoubleEquals', severity: 'warning', message: 'Using == may be unsafe if you are relying on type coercion.' },
        { path: 'src/seed/view.tsx', line: 5, rule: 'lint/security/noDangerouslySetInnerHtml', severity: 'warning', message: 'Avoid passing content using the dangerouslySetInnerHTML prop.' },
      ],
      omittedFindings: 0,
    })
    expect(o.signals.security.findings.map((f) => [f.path, f.line, f.rule])).toEqual([
      ['src/seed/findings.ts', 7, 'eval'],
      ['src/seed/view.tsx', 5, 'dangerously-set-inner-html'],
    ])
    golden('signals-biome', 'expected.json', o)
  })

  it('Biome: a finding on an unchanged non-script file named like a changed file is context', async () => {
    const o = await run('signals-biome', { eslint: 'biome-css.json' })
    expect(o.reasons.map((r) => r.code)).not.toContain('analysis-error')
    expect(o.signals.lint).toMatchObject({ status: 'ok', changedLines: { errors: 0, warnings: 0 }, otherLines: { errors: 0, warnings: 1 } })
  })

  it('an empty lint report (what Biome gives for a clean project) is ok with no findings', async () => {
    const o = await run('signals-biome', { eslint: 'empty.json' })
    expect(o.signals.lint).toEqual({ status: 'ok', changedLines: { errors: 0, warnings: 0 }, otherLines: { errors: 0, warnings: 0 }, findings: [], omittedFindings: 0 })
  })

  it('suppressions: added directives and as any are found, the same text in strings is not', async () => {
    const o = await run('signals-suppressions', 'none')
    expect(o.signals.suppressions.items.map((i) => [i.path, i.line, i.kind])).toEqual([
      ['src/lib/unsafe.ts', 1, 'eslint-disable-next-line'],
      ['src/lib/unsafe.ts', 3, 'ts-expect-error'],
      ['src/lib/unsafe.ts', 4, 'as-any'],
    ])
    golden('signals-suppressions', 'expected.json', o)
  })

  it('without reports: coverage and lint are not-provided, never approved', async () => {
    const o = await run('signals-coverage-lint', 'none')
    expect(o.signals.coverage).toEqual({ status: 'not-provided', message: 'no coverage report given (--coverage or signals.coverage)', files: [], total: null, ignoredFiles: [] })
    expect(o.signals.lint.status).toBe('not-provided')
    expect(o.signals.lint.message).toBe('no ESLint or Biome report given (--eslint or signals.eslint)')
    expect(o.signals.lint.changedLines).toBeNull()
    golden('signals-coverage-lint', 'expected-no-reports.json', o)
  })

  it('coverage-only ignore leaves files out of coverage but not of the rest of the analysis', async () => {
    const s = createScenarioRepo('signals-coverage-lint')
    repos.push(s)
    const config = JSON.parse(s.repo.read('farol.config.json')) as { signals?: Record<string, unknown> }
    s.repo.write('farol.config.json', JSON.stringify({ ...config, signals: { coverageIgnore: ['src/lib/discount.ts'] } }))
    const o = (await analyzeRepo(s.repo, { coverage: report('signals-coverage-lint', 'coverage-final.json', s.repo.dir), coverageIgnore: ['**/format.ts'] })).output
    expect(o.signals.coverage.ignoredFiles).toEqual(['src/lib/discount.ts', 'src/lib/format.ts'])
    expect(o.signals.coverage.files).toEqual([])
    expect(o.files.map((f) => f.path)).toContain('src/lib/discount.ts')
    expect(o.risk.files.map((f) => f.path)).toEqual(['src/lib/format.ts', 'src/lib/discount.ts'])
  })

  it('security: static findings on added lines and vulnerabilities only for added or changed dependencies', async () => {
    const s = createScenarioRepo('security')
    repos.push(s)
    const o = (await analyzeRepo(s.repo, { audit: join(FIXTURES_DIR, 'security', 'reports', 'audit.json') })).output
    expect(o.signals.security.findings.map((f) => [f.path, f.line, f.rule, f.severity])).toEqual([
      ['src/lib/render-html.ts', 2, 'inner-html', 'high'],
      ['src/lib/render-html.ts', 5, 'hardcoded-secret', 'high'],
    ])
    // lodash is vulnerable too, but this PR did not touch it.
    expect(o.signals.vulnerabilities.related.map((r) => [r.package, r.severity, r.kind, r.relatedTo])).toEqual([['clsx', 'high', 'direct', ['clsx']]])
    expect(o.signals.vulnerabilities.total).toEqual({ critical: 0, high: 1, moderate: 1, low: 0, info: 0 })
    golden('security', 'expected.json', o)
  })

  it('a report path that cannot be resolved (a symlink loop) is an error naming the path', async () => {
    const s = createScenarioRepo('signals-coverage-lint')
    repos.push(s)
    const loop = join(s.repo.dir, 'loop')
    symlinkSync(loop, loop)
    const eslint = join(tmp, 'loop-eslint.json')
    writeFileSync(eslint, JSON.stringify([{ filePath: join(loop, 'a.ts'), messages: [] }]))
    const o = (await analyzeRepo(s.repo, { eslint })).output
    expect(o.signals.lint).toMatchObject({ status: 'error', changedLines: null })
    expect(o.signals.lint.message).toMatch(/^cannot resolve the report path .+\/loop\/a\.ts: ELOOP$/)
  })

  it('a missing or unreadable report is reported, not approved', async () => {
    const s = createScenarioRepo('signals-coverage-lint')
    repos.push(s)
    const broken = join(tmp, 'broken.json')
    writeFileSync(broken, '{"not":"istanbul"}')
    const o = (await analyzeRepo(s.repo, { coverage: join(tmp, 'nope.json'), eslint: broken })).output
    expect(o.signals.coverage.status).toBe('not-provided')
    expect(o.signals.coverage.message).toMatch(/^coverage report not found at .*nope\.json$/)
    expect(o.signals.lint).toMatchObject({ status: 'error', message: 'the ESLint report is not in the "eslint -f json" format', changedLines: null })
  })
})
