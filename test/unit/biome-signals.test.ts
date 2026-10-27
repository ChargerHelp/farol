import { describe, expect, it } from 'vitest'
import { type BiomeHead, isBiomeReport, parseBiomeReport } from '../../src/signals/biome.js'
import { isRuffReport } from '../../src/signals/python.js'

/** The head commit as the reader sees it: the changed files, and whether a path is a file. */
const head = (changed: string[], other: string[] = []): BiomeHead => ({ changed, exists: (path) => [...changed, ...other].includes(path) })

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
    expect(parseBiomeReport(text, '/repo', 'svc', head([])).map((m) => [m.path, m.line, m.rule, m.severity, m.message])).toEqual([
      ['svc/src/a.ts', 1, 'lint/a/fatal', 'error', 'lint/a/fatal found'],
      ['svc/src/a.ts', 2, 'lint/a/error', 'error', 'lint/a/error found'],
      ['svc/src/a.ts', 3, 'lint/a/warning', 'warning', 'lint/a/warning found'],
      ['svc/src/a.ts', 4, 'lint/a/information', 'warning', 'lint/a/information found'],
      ['svc/src/a.ts', 5, 'lint/a/hint', 'warning', 'lint/a/hint found'],
      ['svc/src/b.ts', 9, 'parse', 'error', 'parse found'],
    ])
  })

  it('rejects a report of the wrong shape, naming the Biome command', () => {
    const text = JSON.stringify([{ ...entry('lint/a/b', 'major', 'src/a.ts', 1), location: { path: 'src/a.ts' } }])
    expect(() => parseBiomeReport(text, '/repo', '', head([]))).toThrow(/^the lint report is not Biome GitLab output \(biome lint --reporter=gitlab\): 0\.location\.lines: /)
  })

  it('names the report itself when it is not a list', () => {
    expect(() => parseBiomeReport('{}', '/repo', '', head([]))).toThrow(/^the lint report is not Biome GitLab output \(biome lint --reporter=gitlab\): \(root\): /)
  })

  it('does not take a ruff report for a Biome report', () => {
    const ruff = JSON.stringify([{ code: 'F401', message: 'unused import', filename: '/repo/src/a.py', location: { row: 1, column: 1 } }])
    expect(isRuffReport(ruff)).toBe(true)
    expect(isBiomeReport(ruff)).toBe(false)
  })

  it('rejects a report written from another folder than the project directory', () => {
    const services = head(['services/assess/src/a.ts'])
    const paths = ['services/assess/src/a.ts', 'services\\assess\\src\\a.ts', './services/assess/src/a.ts', 'assess/src/a.ts']
    for (const path of paths) {
      const text = JSON.stringify([entry('lint/a/b', 'major', 'src/b.ts', 1), entry('lint/a/b', 'major', path, 2)])
      expect(() => parseBiomeReport(text, '/repo', 'services/assess', services)).toThrow(`the Biome report path ${path} is not relative to the project directory: run biome in services/assess`)
    }
  })

  it('reads a path that is a file of the project as a project path, even when a changed file ends with it', () => {
    const app = JSON.stringify([entry('lint/a/b', 'major', 'app/page.tsx', 1)])
    expect(parseBiomeReport(app, '/repo', 'app', head(['app/app/page.tsx'])).map((m) => m.path)).toEqual(['app/app/page.tsx'])
    const nested = JSON.stringify([entry('lint/a/b', 'major', 'src/a.ts', 1)])
    expect(parseBiomeReport(nested, '/repo', 'svc', head(['svc/src/x/src/a.ts'], ['svc/src/a.ts'])).map((m) => m.path)).toEqual(['svc/src/a.ts'])
  })
})
