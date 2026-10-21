import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputSchema } from '../../src/output/schema.js'
import { renderHtml } from '../../src/report/html.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

const golden = (scenario: string) => OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, scenario, 'expected.json'), 'utf8')))

describe('review record', () => {
  it('has the flag panel, checks on findings and contract changes, and the Result tab with its data', () => {
    const html = renderHtml(golden('p10-contracts'))
    expect(html).toContain('<details class="review flags" id="flags">')
    expect(html).toContain('data-flag-key="POST /brands"')
    expect(html).toContain('data-ack="contract:POST /brands"')
    expect(html).toContain('<a href="#result">Result')
    const data = /<script type="application\/json" id="result-data">(.*?)<\/script>/.exec(html)?.[1] ?? ''
    expect(data).not.toContain('<')
    const parsed = JSON.parse(data) as { contracts: { id: string; label: string }[]; verdict: string }
    expect(parsed.contracts.map((c) => c.label)).toEqual(['GET /brands (breaking)', 'GET /brands/{brand_id} (breaking)', 'POST /brands (breaking)'])
    expect(parsed.verdict).toBe('⚠ Careful review')
  })

  it('shows suggested reviewers in their own tab, not in the overview', () => {
    const o = golden('p10-contracts')
    const html = renderHtml({ ...o, ownership: { farolReviewers: 1, head: o.head.sha, prAuthors: [], codeowners: [], reviewers: [{ name: 'Ana', score: 40, active: true, files: [] }], files: [] } })
    const overview = html.slice(html.indexOf('id="overview"'), html.indexOf('id="tests"'))
    expect(overview).not.toContain('class="ownership"')
    expect(html).toContain('<div class="section" id="reviewers">')
  })
})
