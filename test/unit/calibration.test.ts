import { describe, expect, it } from 'vitest'
import { calibrate, labelCommits, type CalibrationPoint } from '../../src/review/calibration.js'

const day = (n: number): string => new Date(Date.UTC(2026, 0, 1 + n)).toISOString()

describe('calibration', () => {
  it('labels commits reverted or followed by a fix of the same files within the window', () => {
    const labels = labelCommits([
      { sha: 'a1', date: day(0), subject: 'feat: add brands page', files: ['src/brands.ts'] },
      { sha: 'b2', date: day(1), subject: 'feat: users', files: ['src/users.ts'] },
      { sha: 'c3', date: day(2), subject: 'fix(brands): empty list crash', files: ['src/brands.ts'] },
      { sha: 'd4', date: day(3), subject: 'feat: settings', files: ['src/settings.ts'] },
      { sha: 'e5', date: day(30), subject: 'fix: settings typo', files: ['src/settings.ts'] },
      { sha: 'f6', date: day(31), subject: 'feat: export', files: ['src/export.ts'] },
      { sha: 'g7', date: day(32), subject: 'Revert "feat: export"', files: ['src/export.ts'] },
    ])
    expect([...labels].filter(([, l]) => l.bad).map(([sha, l]) => [sha, l.reason?.split(' ').slice(0, 3).join(' ')])).toEqual([
      ['a1', 'fixed by c3'],
      ['f6', 'reverted by g7'],
    ])
  })

  it('reports bad rates by verdict and score, the ranking quality and thresholds', () => {
    const points: CalibrationPoint[] = [
      ...Array.from({ length: 10 }, (_, i): CalibrationPoint => ({ sha: `l${i}`, score: 5 + i, verdict: 'pass', classification: 'isolated', bad: i === 0 })),
      ...Array.from({ length: 10 }, (_, i): CalibrationPoint => ({ sha: `h${i}`, score: 70 + i, verdict: 'careful', classification: 'touches-existing', bad: i >= 4 })),
    ]
    const r = calibrate(points)
    expect(r.total).toBe(20)
    expect(r.baseRate).toBe(0.35)
    expect(r.byVerdict.pass).toEqual({ n: 10, bad: 1, rate: 0.1 })
    expect(r.byVerdict.careful).toEqual({ n: 10, bad: 6, rate: 0.6 })
    expect(r.byVerdict.quick).toEqual({ n: 0, bad: 0, rate: 0 })
    expect(r.auc).toBeGreaterThan(0.8)
    expect(r.suggested.careful).not.toBeNull()
    expect(r.suggested.quick).not.toBeNull()
  })
})
