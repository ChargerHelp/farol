import { describe, expect, it } from 'vitest'
import { ownersOf, parseCodeowners, rankReviewers } from '../../src/review/reviewers.js'

describe('reviewers', () => {
  it('reads CODEOWNERS like GitHub: anchored paths, directories, any-depth names, last rule wins', () => {
    const rules = parseCodeowners(['# owners', '*        @acme/all', '/src/api/   @acme/api', 'docs      @acme/docs', '*.sql    @dba', '/src/api/legacy.ts @ana'].join('\n'))
    expect(ownersOf(rules, 'README.md')).toEqual(['@acme/all'])
    expect(ownersOf(rules, 'src/api/brands.ts')).toEqual(['@acme/api'])
    expect(ownersOf(rules, 'src/api/legacy.ts')).toEqual(['@ana'])
    expect(ownersOf(rules, 'packages/x/docs/guide.md')).toEqual(['@acme/docs'])
    expect(ownersOf(rules, 'src/api/db/schema.sql')).toEqual(['@dba'])
  })

  it('ranks owners by files owned and authors by files touched, without the PR authors and bots', () => {
    const rules = parseCodeowners('/src/ @acme/web')
    const history = new Map([
      ['src/a.ts', ['Ana', 'Bo', 'Ana', 'dependabot[bot]']],
      ['src/b.ts', ['Ana', 'Cy']],
    ])
    const ranked = rankReviewers(['src/a.ts', 'src/b.ts'], rules, history, new Set(['Bo']))
    expect(ranked.map((r) => [r.name, r.kind, r.files.length, r.commits])).toEqual([
      ['@acme/web', 'codeowner', 2, 0],
      ['Ana', 'history', 2, 3],
      ['Cy', 'history', 1, 1],
    ])
  })
})
