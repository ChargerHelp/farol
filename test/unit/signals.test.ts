import { describe, expect, it } from 'vitest'
import type { ChangedFile } from '../../src/git/types.js'
import { coverageSignal, parseCoverageReport, ReportError } from '../../src/signals/coverage.js'
import { lintSignal, parseEslintReport } from '../../src/signals/lint.js'
import { reportPathToRepo, toRanges } from '../../src/signals/paths.js'
import { testsModifiedSignal } from '../../src/signals/tests-modified.js'

const changed = (path: string, lines: number[], status: ChangedFile['status'] = 'modified'): ChangedFile => ({
  path,
  status,
  added: lines.map((line) => ({ line, text: '' })),
  removed: [],
  binary: false,
})

describe('paths and ranges', () => {
  it('groups contiguous lines', () => {
    expect(toRanges([5, 1, 2, 3, 9, 10, 2])).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 9, end: 10 },
    ])
  })

  it('maps report paths to repo paths', () => {
    expect(reportPathToRepo('/repo/apps/web/src/a.ts', '/repo', 'apps/web')).toBe('apps/web/src/a.ts')
    expect(reportPathToRepo('src/a.ts', '/repo', 'apps/web')).toBe('apps/web/src/a.ts')
    expect(reportPathToRepo('C:\\repo\\src\\a.ts', 'C:/repo', '')).toBe('src/a.ts')
    expect(reportPathToRepo('/elsewhere/a.ts', '/repo', '')).toBeUndefined()
  })
})

describe('coverage', () => {
  const report = parseCoverageReport(
    JSON.stringify({
      '/repo/src/a.ts': {
        path: '/repo/src/a.ts',
        statementMap: { '0': { start: { line: 1 }, end: { line: 3 } }, '1': { start: { line: 2 }, end: { line: 2 } }, '2': { start: { line: 5 }, end: { line: 5 } } },
        s: { '0': 1, '1': 0, '2': 4 },
      },
    }),
    '/repo',
    '',
  )

  it('needs every intersecting statement to have run', () => {
    const s = coverageSignal(report, [changed('src/a.ts', [1, 2, 4, 5])], () => 'source')
    expect(s.files).toEqual([{ path: 'src/a.ts', changedExecutableLines: 3, coveredLines: 2, uncovered: [{ start: 2, end: 2 }], missingFromReport: false }])
  })

  it('only counts added/modified source code files', () => {
    const files = [changed('src/a.ts', [1], 'renamed'), changed('src/b.css', [1]), changed('src/c.test.ts', [1]), changed('src/d.d.ts', [1])]
    expect(coverageSignal(report, files, (p) => (p.includes('.test.') ? 'test' : 'source')).files).toEqual([])
  })

  it('rejects files that are not Istanbul JSON', () => {
    expect(() => parseCoverageReport('[1]', '/repo', '')).toThrow(ReportError)
    expect(() => parseCoverageReport('nope', '/repo', '')).toThrow(/not valid JSON/)
  })
})

describe('lint', () => {
  it('caps findings at 50 and counts the rest', () => {
    const messages = Array.from({ length: 60 }, (_, i) => ({ ruleId: 'r', severity: i % 2 === 0 ? 2 : 1, message: 'm', line: i + 1 }))
    const parsed = parseEslintReport(JSON.stringify([{ filePath: '/repo/src/a.ts', messages }]), '/repo', '')
    const s = lintSignal(parsed, [changed('src/a.ts', Array.from({ length: 60 }, (_, i) => i + 1))])
    expect(s.changedLines).toEqual({ errors: 30, warnings: 30 })
    expect(s.findings).toHaveLength(50)
    expect(s.omittedFindings).toBe(10)
    expect(s.findings[0]?.severity).toBe('error')
    expect(s.findings[49]?.severity).toBe('warning')
  })

  it('names fatal parse errors', () => {
    const parsed = parseEslintReport(JSON.stringify([{ filePath: '/repo/a.ts', messages: [{ ruleId: null, fatal: true, severity: 2, message: 'Parsing error', line: 1 }] }]), '/repo', '')
    expect(parsed[0]?.rule).toBe('(fatal)')
  })
})

describe('tests modified', () => {
  it('lists modified, deleted and renamed tests, not new ones', () => {
    const files: ChangedFile[] = [
      { ...changed('src/a.test.ts', [], 'modified'), removed: [{ line: 1, text: '' }] },
      changed('src/b.test.ts', [], 'added'),
      changed('src/c.test.ts', [], 'deleted'),
      { ...changed('src/e.test.ts', [], 'renamed'), oldPath: 'src/d.test.ts' },
    ]
    expect(testsModifiedSignal(files, (p) => (p.endsWith('.test.ts') ? 'test' : 'source')).files).toEqual([
      { path: 'src/a.test.ts', status: 'modified', linesRemoved: 1 },
      { path: 'src/c.test.ts', status: 'deleted', linesRemoved: 0 },
      { path: 'src/e.test.ts', oldPath: 'src/d.test.ts', status: 'renamed', linesRemoved: 0 },
    ])
  })
})

describe('reports written in another checkout', () => {
  const eslint = (...paths: string[]): string => JSON.stringify(paths.map((filePath) => ({ filePath, messages: [{ ruleId: 'r', severity: 2, message: 'm', line: 1 }] })))
  const istanbul = (path: string): string => JSON.stringify({ key: { path, statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } }, s: { '0': 1 } } })

  it('rejects a report whose paths are all outside the repository, naming the first one', () => {
    expect(() => parseEslintReport(eslint('/src/apps/web/a.ts', '/src/apps/web/b.ts'), '/repo', 'apps/web')).toThrow('the ESLint report names no file in the repository /repo (first path: /src/apps/web/a.ts): write the report in the same checkout as farol')
    expect(() => parseEslintReport(eslint('C:\\other\\src\\a.ts'), '/repo', '')).toThrow('(first path: C:\\other\\src\\a.ts)')
  })

  it('rejects relative paths that climb above the repository root', () => {
    expect(() => parseEslintReport(eslint('../../../other/a.ts'), '/repo', 'apps/web')).toThrow(/names no file in the repository/)
  })

  it('reads a report with some paths in the repository as before', () => {
    expect(parseEslintReport(eslint('/elsewhere/x.ts', '/repo/apps/web/a.ts'), '/repo', 'apps/web').map((m) => m.path)).toEqual(['/elsewhere/x.ts', 'apps/web/a.ts'])
    expect(parseEslintReport('[]', '/repo', '')).toEqual([])
  })

  it('reads an outside path that resolves into the repository (a symlink) as a repository path', () => {
    const canonical = (p: string): string => p.replace('/link/', '/repo/')
    expect(parseEslintReport(eslint('/link/a.ts'), '/repo', '', canonical).map((m) => m.path)).toEqual(['a.ts'])
  })

  it('checks the Istanbul entry path, not the key', () => {
    expect(() => parseCoverageReport(istanbul('/src/a.ts'), '/repo', '')).toThrow('the coverage report names no file in the repository /repo (first path: /src/a.ts)')
  })
})
