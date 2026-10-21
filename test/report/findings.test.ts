import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { keyFindings } from '../../src/report/findings.js'
import { commonDirectory, displayPrefix, renderHtml } from '../../src/report/html.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

function golden(scenario: string, file = 'expected.json'): Output {
  return OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, scenario, file), 'utf8')))
}

const summary = (o: Output) => keyFindings(o).map((f) => [f.severity, f.title])

describe('key findings', () => {
  it('puts the reasons of an unknown result first', () => {
    expect(summary(golden('11-routes-from-map'))[0]).toEqual(['high', '1 route construct farol cannot read'])
    expect(summary(golden('20-syntax-error'))[0]).toEqual(['high', 'Syntax error in 1 changed file'])
  })

  it('flags global files, changed routes and loosened tests', () => {
    expect(summary(golden('10-global-css'))[0]).toEqual(['high', '1 global file changed'])
    expect(summary(golden('07-route-component-swapped'))).toContainEqual(['high', '1 existing route removed or changed'])
    expect(summary(golden('17-test-only'))[0]).toEqual(['medium', '1 existing test modified, 4 lines removed'])
  })

  it('reports coverage, missing files, lint and suppressions from the signals', () => {
    const cov = keyFindings(golden('signals-coverage-lint'))
    expect(cov.map((f) => [f.severity, f.title, f.files])).toEqual([
      ['high', '1 lint error on changed lines', ['src/lib/format.ts']],
      ['medium', 'Diff coverage of 66.7% in the files present in the report', ['src/lib/format.ts']],
      ['medium', '1 changed file missing from the coverage report', ['src/lib/discount.ts']],
      ['low', 'Dependency audit not verified', []],
      ['low', '1 lint warning on changed lines', ['src/lib/format.ts']],
      // format.ts only gains functions (declaration-level additive): no high-risk change.
      ['low', 'No existing code touched', []],
    ])
    expect(summary(golden('signals-suppressions'))).toContainEqual(['medium', '3 added suppressions'])
  })

  it('marks signals without reports as not verified and isolated PRs as such', () => {
    const iso = summary(golden('01-new-route'))
    expect(iso).toEqual([
      ['low', 'Dependency audit not verified'],
      ['low', 'Lint not verified'],
      ['low', 'Coverage not verified'],
      ['low', 'No existing code touched'],
    ])
  })

  it('turns central files into high-risk findings', () => {
    const findings = keyFindings(golden('04-child-of-modified-layout'))
    expect(findings.find((f) => f.section === 'risk')).toMatchObject({
      severity: 'high',
      title: '1 high-risk change: central files used by many existing pages',
      files: ['src/layouts/AppLayout.tsx'],
      detail: 'Review carefully and test the pages that use them: AppLayout.tsx (4/4 pages, 3 dependents).',
    })
  })
})

describe('html report', () => {
  it('finds the shared directory of paths', () => {
    expect(commonDirectory(['apps/web/src/a.ts', 'apps/web/src/b/c.ts'])).toBe('apps/web/src/')
    expect(commonDirectory(['a.ts', 'src/b.ts'])).toBe('')
    expect(commonDirectory([])).toBe('')
    expect(displayPrefix(['apps/web/src/a.ts', 'apps/web/src/b.ts', 'apps/web/package.json', 'pnpm-lock.yaml'])).toBe('apps/web/')
    expect(displayPrefix(['apps/web/a.ts', 'apps/api/b.ts', 'c.ts'])).toBe('')
  })

  it('renders a self-contained page with the class, the findings and every section', async () => {
    const html = renderHtml(golden('signals-coverage-lint'))
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).not.toMatch(/(src|href)="https?:/)
    // Twelve scripts: theme, Risk filters, score, plan rows, test checklist, Result (and its JSON data), reviewed files, Mermaid and highlight.js loaders (pinned, on demand), full screen and the entry filter.
    expect(html.match(/<script/g)).toHaveLength(12)
    expect(html).toContain('id="theme-toggle"')
    expect(html).toContain('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs')
    for (const id of ['overview', 'risk', 'dependencies', 'signals', 'routes', 'files', 'details']) {
      expect(html).toContain(`id="${id}"`)
      expect(html).toContain(`href="#${id}"`)
    }
    expect(html).not.toContain('name="tab"')
    expect(html).toMatch(/class="panel plan plan-(pass|quick|careful)" id="plan"/)
    expect(html).toMatch(/<span class="badge small-badge isolated"[^>]*>isolated<\/span>/)
    expect(html).toContain('Diff coverage of 66.7% in the files present in the report')
    await expect(html).toMatchFileSnapshot('./__snapshots__/signals.html')
  })

  it('escapes text coming from the JSON', () => {
    const html = renderHtml(golden('11-routes-from-map'))
    expect(html).toContain('element: &lt;Page /&gt;')
    expect(html).not.toContain('<Page />')
  })
})
