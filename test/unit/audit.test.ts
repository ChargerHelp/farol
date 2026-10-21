import { describe, expect, it } from 'vitest'
import { ReportError } from '../../src/signals/coverage.js'
import { parseAuditReport, vulnerabilitiesSignal } from '../../src/signals/audit.js'

const npm = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    'markdown-lib': { name: 'markdown-lib', severity: 'high', isDirect: true, via: ['sanitizer'], effects: [], range: '>=2.0.0', nodes: [], fixAvailable: true },
    sanitizer: {
      name: 'sanitizer',
      severity: 'high',
      isDirect: false,
      via: [{ source: 1, name: 'sanitizer', dependency: 'sanitizer', title: 'XSS in sanitizer', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'high', range: '<1.4.2' }],
      effects: ['markdown-lib'],
    },
    'old-lib': { name: 'old-lib', severity: 'moderate', isDirect: true, via: [{ name: 'old-lib', title: 'Prototype pollution', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff', severity: 'moderate', range: '<3' }] },
  },
  metadata: {},
})

const pnpm = JSON.stringify({
  advisories: {
    '1100': {
      module_name: 'tiny-json',
      severity: 'critical',
      title: 'RCE in tiny-json',
      url: 'https://github.com/advisories/GHSA-1111-2222-3333',
      cves: ['CVE-2026-1234'],
      github_advisory_id: 'GHSA-1111-2222-3333',
      vulnerable_versions: '<2.0.1',
      patched_versions: '>=2.0.1',
      findings: [{ version: '2.0.0', paths: ['apps__web>@acme/charts>tiny-json'] }],
    },
  },
  metadata: {},
})

describe('audit reports', () => {
  it('npm: matches advisories on a changed package and on packages it depends on', () => {
    const v = vulnerabilitiesSignal(parseAuditReport(npm), new Set(['markdown-lib', 'react']))
    expect(v.related).toEqual([
      { package: 'sanitizer', severity: 'high', title: 'XSS in sanitizer', id: 'GHSA-aaaa-bbbb-cccc', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', cves: [], vulnerableRange: '<1.4.2', patchedVersions: null, relatedTo: ['markdown-lib'], kind: 'transitive' },
    ])
    expect(v.total).toEqual({ critical: 0, high: 1, moderate: 1, low: 0, info: 0 })
  })

  it('pnpm: uses the dependency paths of each advisory', () => {
    const v = vulnerabilitiesSignal(parseAuditReport(pnpm), new Set(['@acme/charts']))
    expect(v.related.map((r) => [r.package, r.severity, r.id, r.cves, r.patchedVersions, r.relatedTo, r.kind])).toEqual([['tiny-json', 'critical', 'GHSA-1111-2222-3333', ['CVE-2026-1234'], '>=2.0.1', ['@acme/charts'], 'transitive']])
    expect(vulnerabilitiesSignal(parseAuditReport(pnpm), new Set(['tiny-json'])).related[0]?.kind).toBe('direct')
  })

  it('rejects other formats', () => {
    expect(() => parseAuditReport('{"foo":1}')).toThrow(ReportError)
    expect(() => parseAuditReport('nope')).toThrow(/not valid JSON/)
  })
})
