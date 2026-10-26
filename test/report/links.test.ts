import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { renderHtml } from '../../src/report/html.js'
import { createLinker, diffAnchor } from '../../src/report/links.js'
import { renderReport } from '../../src/report/markdown.js'
import { detailsOf } from '../helpers/html.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

const base = OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, 'signals-coverage-lint', 'expected.json'), 'utf8')))
const output: Output = { ...base, repo: 'acme/shop', pr: 42, mergeBase: 'a'.repeat(40), head: { ref: 'feature', sha: 'b'.repeat(40) } }
const anchor = (p: string) => `diff-${createHash('sha256').update(p).digest('hex')}`

describe('links', () => {
  it('points changed files at the PR diff and other files at the analyzed commit', () => {
    const l = createLinker(output, { repo: 'acme/shop', pr: 42 })
    expect(diffAnchor('src/lib/format.ts')).toBe(anchor('src/lib/format.ts'))
    expect(l.file('src/lib/format.ts')).toBe(`https://github.com/acme/shop/pull/42/files#${anchor('src/lib/format.ts')}`)
    expect(l.lines('src/lib/format.ts', 7)).toBe(`https://github.com/acme/shop/pull/42/files#${anchor('src/lib/format.ts')}R7`)
    expect(l.lines('src/lib/format.ts', 7, 9)).toBe(`https://github.com/acme/shop/pull/42/files#${anchor('src/lib/format.ts')}R7-R9`)
    expect(l.file('src/pages/HomePage.tsx')).toBe(`https://github.com/acme/shop/blob/${'b'.repeat(40)}/src/pages/HomePage.tsx`)
    expect(l.lines('src/pages/HomePage.tsx', 3, 5)).toBe(`https://github.com/acme/shop/blob/${'b'.repeat(40)}/src/pages/HomePage.tsx#L3-L5`)
  })

  it('uses the compare view without a PR, the left side for deleted files, and no links without a repository', () => {
    const deleted: Output = { ...output, files: [{ path: 'src/gone.ts', status: 'deleted', role: 'source', linesAdded: 0, linesRemoved: 3 }] }
    const l = createLinker(deleted, { repo: 'acme/shop', pr: null, serverUrl: 'https://ghe.local/' })
    expect(l.lines('src/gone.ts', 2)).toBe(`https://ghe.local/acme/shop/compare/${'a'.repeat(40)}...${'b'.repeat(40)}#${anchor('src/gone.ts')}L2`)
    expect(createLinker(output, { repo: null, pr: 42 }).file('src/lib/format.ts')).toBeNull()
  })

  it('links files and line ranges in the HTML and the PR comment', () => {
    const l = createLinker(output, { repo: 'acme/shop', pr: 42 })
    const html = detailsOf(renderHtml(output, l))
    expect(html).toContain(`href="https://github.com/acme/shop/pull/42/files#${anchor('src/lib/format.ts')}R14"`)
    expect(html).toContain(`href="https://github.com/acme/shop/pull/42/files#${anchor('src/lib/discount.ts')}R1-R3"`)
    const md = renderReport(output, undefined, l)
    expect(md).toContain(`[\`src/lib/format.ts:9\`](https://github.com/acme/shop/pull/42/files#${anchor('src/lib/format.ts')}R9)`)
    expect(md).toContain(`[1–3](https://github.com/acme/shop/pull/42/files#${anchor('src/lib/discount.ts')}R1-R3)`)
  })
})
