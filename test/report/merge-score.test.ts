import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { scoreBox, scoreGroups } from '../../src/report/html-score.js'
import { combineScore, mergeScore, scoreItems, scoreLevel } from '../../src/report/merge-score.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

function golden(scenario: string): Output {
  return OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, scenario, 'expected.json'), 'utf8')))
}

describe('merge risk score', () => {
  it('combines weights as the chance that at least one item breaks something', () => {
    expect(combineScore([])).toBe(0)
    expect(combineScore([{ weight: 0.5 }])).toBe(50)
    expect(combineScore([{ weight: 0.5 }, { weight: 0.5 }])).toBe(75)
    expect(scoreLevel(60)).toBe('high')
    expect(scoreLevel(30)).toBe('medium')
    expect(scoreLevel(29)).toBe('low')
  })

  it('ranks global and touches-existing PRs above isolated ones', () => {
    const global = mergeScore(golden('10-global-css')).score
    const touches = mergeScore(golden('05-shared-component')).score
    const isolated = mergeScore(golden('01-new-route')).score
    expect(global).toBeGreaterThan(isolated)
    expect(touches).toBeGreaterThan(isolated)
    // Calibrated weight: a global change alone is medium risk, not high.
    expect(scoreLevel(global)).toBe('medium')
  })

  it('gives added declaration-only files one point each, five for all of them together', () => {
    const o = golden('01-new-route')
    const added = o.risk.files.filter((f) => f.change === 'added').map((f) => f.path)
    expect(added.length).toBeGreaterThan(0)
    const mark = (n: number): Output => ({ ...o, files: o.files.map((f) => (added.slice(0, n).includes(f.path) ? { ...f, declarationsOnly: true as const } : f)) })
    const weights = (out: Output) => scoreItems(out).filter((i) => i.kind === 'change' && out.files.some((f) => f.path === i.file && f.declarationsOnly)).map((i) => i.weight)
    expect(weights(mark(1))).toEqual([0.01])
    const first = o.risk.files[0]
    if (first === undefined) throw new Error('the golden has risk files')
    const many: Output = { ...o, risk: { ...o.risk, files: Array.from({ length: 10 }, (_, i) => ({ ...first, path: `src/t${i}.types.ts`, change: 'added' as const })) }, files: Array.from({ length: 10 }, (_, i) => ({ path: `src/t${i}.types.ts`, status: 'added' as const, role: 'source' as const, linesAdded: 3, linesRemoved: 0, declarationsOnly: true as const })) }
    expect(combineScore(scoreItems(many))).toBeLessThanOrEqual(5)
  })

  it('weighs each changed file by its diff coverage: fully covered keeps 30% of its risk, uncovered all of it', () => {
    const o = golden('signals-coverage-lint')
    const changeOf = (out: Output) => scoreItems(out).find((i) => i.kind === 'change' && i.file === 'src/lib/format.ts')
    const withCoverage = (covered: number): Output => ({
      ...o,
      signals: { ...o.signals, coverage: { ...o.signals.coverage, files: o.signals.coverage.files.map((f) => (f.path === 'src/lib/format.ts' ? { ...f, changedExecutableLines: 10, coveredLines: covered, missingFromReport: false } : f)) } },
    })
    const none = changeOf(withCoverage(0))
    const full = changeOf(withCoverage(10))
    expect(none?.title).toContain('0% of changed lines covered')
    expect(full?.title).toContain('100% of changed lines covered')
    expect((full?.weight ?? 0) / (none?.weight ?? 1)).toBeCloseTo(0.3, 2)
    // Without a coverage report the risk stays whole (fail closed).
    const unverified = changeOf({ ...o, signals: { ...o.signals, coverage: { ...o.signals.coverage, status: 'not-provided', files: [] } } })
    expect(unverified?.weight).toBe(none?.weight)
    expect(scoreItems(o).every((i) => i.weight > 0 && i.weight < 1)).toBe(true)
  })

  it('groups items by file with the points each group is worth', () => {
    const groups = scoreGroups(scoreItems(golden('signals-coverage-lint')))
    expect(new Set(groups.map((g) => g.file)).size).toBe(groups.length)
    expect(groups.map((g) => g.points)).toEqual([...groups.map((g) => g.points)].sort((a, b) => b - a))
  })

  it('renders the score with its contributors as data for the reviewed-files script', () => {
    const o = golden('signals-coverage-lint')
    const html = scoreBox(o, { path: (p) => `<span>${p}</span>` })
    expect(html).toContain(`<span id="score-value">${mergeScore(o).score}</span>`)
    expect(html).toMatch(/<li data-file="src\/lib\/discount\.ts" data-weights="[\d.,]+"/)
  })
})
