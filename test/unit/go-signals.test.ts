import { describe, expect, it } from 'vitest'
import type { ChangedFile } from '../../src/git/types.js'
import { goSuppressions, isGolangciReport, parseGoCoverProfile, parseGolangciReport, parseGovulncheckReport } from '../../src/signals/go.js'

const changed = (path: string, lines: number[]): ChangedFile => ({ path, status: 'modified', added: lines.map((line) => ({ line, text: '' })), removed: [] }) as unknown as ChangedFile

describe('Go reports', () => {
  it('reads a coverprofile by import path, merging blocks reported by several test binaries', () => {
    const profile = ['mode: set', 'example.com/app/internal/a.go:3.10,5.2 1 0', 'example.com/app/internal/a.go:3.10,5.2 1 1', 'example.com/app/internal/a.go:7.1,8.2 1 0', 'other.com/x/b.go:1.1,2.2 1 1'].join('\n')
    const report = parseGoCoverProfile(profile, 'example.com/app', 'svc')
    expect([...report.keys()]).toEqual(['svc/internal/a.go'])
    expect(report.get('svc/internal/a.go')).toEqual([
      { start: 3, end: 5, count: 1 },
      { start: 7, end: 8, count: 0 },
    ])
    expect(() => parseGoCoverProfile('{}', 'example.com/app', '')).toThrow(/coverprofile/)
  })

  it('reads golangci-lint JSON, keeping gosec issues as security findings', () => {
    const text = JSON.stringify({ Issues: [{ FromLinter: 'errcheck', Text: 'Error return value is not checked', Pos: { Filename: 'internal/a.go', Line: 4 } }, { FromLinter: 'gosec', Text: 'G101: Potential hardcoded credentials', Pos: { Filename: 'internal/a.go', Line: 9 } }] })
    expect(isGolangciReport(text)).toBe(true)
    const { messages, gosec } = parseGolangciReport(text, '/repo', '')
    expect(messages.map((m) => [m.path, m.line, m.rule, m.severity])).toEqual([
      ['internal/a.go', 4, 'errcheck', 'error'],
      ['internal/a.go', 9, 'gosec', 'error'],
    ])
    expect(gosec).toEqual([{ path: 'internal/a.go', line: 9, rule: 'gosec', severity: 'high', message: 'G101: Potential hardcoded credentials' }])
  })

  it('reads govulncheck JSON: called code is high, imported packages moderate', () => {
    const text = [
      JSON.stringify({ config: { scanner_name: 'govulncheck' } }, null, 2),
      JSON.stringify({ osv: { id: 'GO-2024-0001', summary: 'Bad parsing in x', aliases: ['CVE-2024-1', 'GHSA-x'] } }, null, 2),
      JSON.stringify({ finding: { osv: 'GO-2024-0001', fixed_version: 'v1.2.0', trace: [{ module: 'example.com/x', version: 'v1.1.0', package: 'example.com/x/p', function: 'Parse' }, { module: 'example.com/app' }] } }, null, 2),
      JSON.stringify({ finding: { osv: 'GO-2024-0001', trace: [{ module: 'example.com/x', version: 'v1.1.0', package: 'example.com/x/p' }] } }, null, 2),
    ].join('\n')
    const { advisories } = parseGovulncheckReport(text)
    expect(advisories).toEqual([
      { package: 'example.com/x', severity: 'high', title: 'Bad parsing in x', id: 'GO-2024-0001', url: 'https://pkg.go.dev/vuln/GO-2024-0001', cves: ['CVE-2024-1'], vulnerableRange: 'v1.1.0', patchedVersions: 'v1.2.0', paths: [['example.com/x', 'example.com/app']] },
    ])
  })

  it('finds //nolint, //lint:ignore and #nosec on added lines only', () => {
    const comments = [
      { file: 'a.go', line: 3, text: '//nolint:errcheck' },
      { file: 'a.go', line: 4, text: '//lint:ignore SA1019 legacy' },
      { file: 'a.go', line: 5, text: '// #nosec G304' },
      { file: 'a.go', line: 9, text: '//nolint' },
      { file: 'a.go', line: 6, text: '// plain comment' },
    ]
    expect(goSuppressions([changed('a.go', [3, 4, 5, 6])], comments).map((i) => [i.line, i.kind])).toEqual([
      [3, 'nolint'],
      [4, 'lint-ignore'],
      [5, 'nosec'],
    ])
  })
})
