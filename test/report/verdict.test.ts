import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { computeVerdict } from '../../src/report/verdict.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

function golden(scenario: string): Output {
  return OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, scenario, 'expected.json'), 'utf8')))
}

describe('review verdict', () => {
  it('fast-tracks a PR that only adds code, even without a coverage report', () => {
    const v = computeVerdict(golden('g1-new-endpoint'))
    expect(v.level).toBe('pass')
    expect(v.reasons.at(-1)).toContain('diff coverage not verified')
  })

  it('asks for a quick review when existing code changed in a contained way', () => {
    expect(computeVerdict(golden('g2-service-changed')).level).toBe('quick')
  })

  it('asks for a careful review of unknown PRs, and at least a quick one of global PRs', () => {
    // Calibration: global PRs (mostly dependency bumps) were not followed by more problems than other changes.
    expect(computeVerdict(golden('10-global-css')).level).toBe('quick')
    expect(computeVerdict(golden('11-routes-from-map')).level).toBe('careful')
  })

  it('lists files riskiest first and keeps tests and non-code files apart', () => {
    const v = computeVerdict(golden('signals-coverage-lint'))
    const points = [...v.startHere, ...v.skim].map((f) => f.points)
    expect(points).toEqual([...points].sort((a, b) => b - a))
    expect(v.other.every((f) => f.kind !== 'not-code' || !/\.(ts|tsx|go|py)$/.test(f.path))).toBe(true)
  })

  it('flags a central file whose changed lines are mostly untested', () => {
    const o = golden('05-shared-component')
    const central = o.risk.files.find((f) => f.level === 'high')
    expect(central).toBeDefined()
    const files = [{ path: central?.path ?? '', changedExecutableLines: 10, coveredLines: 1, uncovered: [{ start: 1, end: 9 }], missingFromReport: false }]
    const uncovered: Output = { ...o, signals: { ...o.signals, coverage: { status: 'ok', files, total: { changedExecutableLines: 10, coveredLines: 1 }, ignoredFiles: [] } } }
    const v = computeVerdict(uncovered)
    expect(v.level).toBe('careful')
    expect(v.reasons.join('\n')).toContain('little or no diff coverage')
  })
})
