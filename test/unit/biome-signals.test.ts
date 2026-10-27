import { describe, expect, it } from 'vitest'
import { isBiomeReport, parseBiomeReport } from '../../src/signals/biome.js'
import { isRuffReport } from '../../src/signals/python.js'

const entry = (checkName: string, severity: string, path: string, begin: number): Record<string, unknown> => ({
  description: `${checkName} found`,
  check_name: checkName,
  fingerprint: `${checkName}-${begin}`,
  severity,
  location: { path, lines: { begin } },
})

describe('Biome GitLab reports', () => {
  it('reads blocker and critical findings as errors, the other levels as warnings', () => {
    const text = JSON.stringify([
      entry('lint/a/fatal', 'blocker', 'src/a.ts', 1),
      entry('lint/a/error', 'critical', 'src/a.ts', 2),
      entry('lint/a/warning', 'major', 'src/a.ts', 3),
      entry('lint/a/information', 'minor', 'src/a.ts', 4),
      entry('lint/a/hint', 'info', 'src/a.ts', 5),
      entry('parse', 'critical', 'src/b.ts', 9),
    ])
    expect(isBiomeReport(text)).toBe(true)
    expect(parseBiomeReport(text, '/repo', 'svc').map((m) => [m.path, m.line, m.rule, m.severity])).toEqual([
      ['svc/src/a.ts', 1, 'lint/a/fatal', 'error'],
      ['svc/src/a.ts', 2, 'lint/a/error', 'error'],
      ['svc/src/a.ts', 3, 'lint/a/warning', 'warning'],
      ['svc/src/a.ts', 4, 'lint/a/information', 'warning'],
      ['svc/src/a.ts', 5, 'lint/a/hint', 'warning'],
      ['svc/src/b.ts', 9, 'parse', 'error'],
    ])
    expect(parseBiomeReport(text, '/repo', 'svc')[0]?.message).toBe('lint/a/fatal found')
  })

  it('rejects a report of the wrong shape, naming the Biome command', () => {
    const text = JSON.stringify([{ ...entry('lint/a/b', 'major', 'src/a.ts', 1), location: { path: 'src/a.ts' } }])
    expect(() => parseBiomeReport(text, '/repo', '')).toThrow('the lint report is not Biome GitLab output (biome lint --reporter=gitlab)')
  })

  it('does not take a ruff report for a Biome report', () => {
    const ruff = JSON.stringify([{ code: 'F401', message: 'unused import', filename: '/repo/src/a.py', location: { row: 1, column: 1 } }])
    expect(isRuffReport(ruff)).toBe(true)
    expect(isBiomeReport(ruff)).toBe(false)
  })

  it('rejects a report with any path that starts at the repository root when the project is in a subdirectory', () => {
    const text = JSON.stringify([entry('lint/a/b', 'major', 'src/a.ts', 1), entry('lint/a/b', 'major', 'services/assess/src/a.ts', 2)])
    expect(() => parseBiomeReport(text, '/repo', 'services/assess')).toThrow('the Biome report paths start at the repository root: run biome from the project directory')
  })
})
