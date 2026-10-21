import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OutputSchema } from '../../src/output/schema.js'
import type { HistorySummary } from '../../src/cli/history.js'
import { runCli } from '../helpers/cli.js'
import { BASE_APP_DIR, createRepo, FIXTURES_DIR, type TestRepo } from '../helpers/repo.js'

const FEATURES: [string, string][] = [
  ['01-new-route', 'isolated'],
  ['05-shared-component', 'touches-existing'],
  ['10-global-css', 'global'],
  ['18-disconnected-file', 'isolated'],
  ['17-test-only', 'isolated'],
]

describe('history', () => {
  let repo: TestRepo
  const out = mkdtempSync(join(tmpdir(), 'farol-history-'))

  beforeAll(() => {
    repo = createRepo()
    repo.overlay(BASE_APP_DIR)
    repo.commit('base app')
    for (const [scenario] of FEATURES) {
      repo.git('checkout', '-q', '-b', scenario, 'main')
      repo.overlay(join(FIXTURES_DIR, scenario, 'head'))
      repo.commit(`feat: ${scenario}`)
      repo.git('checkout', '-q', 'main')
      repo.git('merge', '-q', '--no-ff', '-m', `Merge ${scenario}`, scenario)
    }
    // A direct commit on main is not a merge and must be skipped by default.
    repo.write('README.md', '# app\n')
    repo.commit('docs: readme')
  })
  afterAll(() => {
    repo.cleanup()
    rmSync(out, { recursive: true, force: true })
  })

  it('writes one JSON per merge and a summary with counts per class', () => {
    const r = runCli(['--cwd', repo.dir, 'history', '--since', '2000-01-01', '--branch', 'main', '--out', out])
    expect(r.stderr).toContain('5 merge commit(s) analyzed (global: 1, unknown: 0, touches-existing: 1, isolated: 3)')
    expect(r.code).toBe(0)
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) as HistorySummary
    expect(summary.total).toBe(5)
    expect(summary.byClass).toEqual({ global: 1, unknown: 0, 'touches-existing': 1, isolated: 3 })
    expect(summary.merges.map((m) => [m.subject, m.classification])).toEqual(FEATURES.map(([s, c]) => [`Merge ${s}`, c]))
    const files = readdirSync(out).filter((f) => f !== 'summary.json')
    expect(files).toHaveLength(5)
    for (const m of summary.merges) {
      const output = OutputSchema.parse(JSON.parse(readFileSync(join(out, m.file), 'utf8')))
      expect(output.head.sha).toBe(m.sha)
      expect(output.mergeBase).toBe(m.firstParent)
    }
  })

  it('--first-parent also analyzes direct commits (squash-merge repositories)', () => {
    const fp = join(out, 'first-parent')
    const r = runCli(['--cwd', repo.dir, 'history', '--since', '2000-01-01', '--branch', 'main', '--out', fp, '--first-parent'])
    expect(r.code).toBe(0)
    const summary = JSON.parse(readFileSync(join(fp, 'summary.json'), 'utf8')) as HistorySummary
    expect(summary.mode).toBe('first-parent')
    expect(summary.total).toBe(6)
    expect(summary.merges.at(-1)?.subject).toBe('docs: readme')
    expect(existsSync(join(fp, `${summary.merges[0]?.sha ?? ''}.json`))).toBe(true)
  })
})
