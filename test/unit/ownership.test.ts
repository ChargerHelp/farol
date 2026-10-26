import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runReviewers } from '../../src/cli/reviewers-run.js'
import { withReviewers } from '../../src/cli/report.js'
import { loadContext } from '../../src/cli/context.js'
import { parseBlameAuthors, parseNumstatAuthors } from '../../src/git/authors.js'
import { detailsOf, workbenchOf } from '../helpers/html.js'
import { renderHtml } from '../../src/report/html.js'
import { renderReport } from '../../src/report/markdown.js'
import { rankOwners, touchedRanges } from '../../src/review/ownership.js'
import { canonicalNames } from '../../src/review/identities.js'
import { analyzeRepo } from '../helpers/analyze.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

const repos: ScenarioRepo[] = []
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
})

describe('authorship parsing', () => {
  it('counts blame lines and added lines per author', () => {
    const blame = ['abc 1 1 1', 'author Ana', 'author-mail <ana@x>', '\tline', 'def 2 2', 'author Bob', 'author-mail <bob@x>', '\tline', 'abc 3 3', 'author Ana', 'author-mail <ana@x>', '\tline', 'f00 4 4', 'author Not Committed Yet', 'author-mail <not.committed.yet>', '\tx'].join('\n')
    expect(Object.fromEntries(parseBlameAuthors(blame))).toEqual({ 'Ana\tana@x': 2, 'Bob\tbob@x': 1 })
    expect(Object.fromEntries(parseNumstatAuthors(['@Ana\tana@x', '', '10\t2\tsrc/a.ts', '-\t-\tlogo.png', '@Bob\t', '', '3\t0\tsrc/b.ts', '4\t1\tsrc/a.ts'].join('\n')))).toEqual({ 'Ana\tana@x': 10, 'Bob\t': 7 })
  })

  it('turns diff hunks into old-side ranges of removed and context lines', () => {
    expect(touchedRanges([{ oldStart: 10, lines: [' a', '-b', '+c', ' d'] }, { oldStart: 20, lines: ['+x', ' y'] }])).toEqual([[10, 12], [20, 20]])
  })
})

describe('canonicalNames', () => {
  it('merges the identities of one person and keeps different people apart', () => {
    const names = canonicalNames(
      ['Jane Doe\tjane@acme.dev', 'jane-doe-acme\t123+jane-doe-acme@users.noreply.github.com', 'Jane Mary Doe\tjmd@home.example', 'johnsmith\tj@x.com', 'John Smith\tjs@y.com', 'Ana Souza\tana@x.com', 'Ana Lima\tana.lima@x.com', 'Carol\tcarol@x.com', 'carol-dev\tcarol@x.com'],
      (id) => (id.startsWith('Jane Doe') ? 10 : 1),
    )
    expect(new Set(['Jane Doe\tjane@acme.dev', 'jane-doe-acme\t123+jane-doe-acme@users.noreply.github.com', 'Jane Mary Doe\tjmd@home.example'].map((id) => names.get(id)))).toEqual(new Set(['Jane Doe']))
    expect(names.get('johnsmith\tj@x.com')).toBe('John Smith')
    expect(names.get('Ana Souza\tana@x.com')).toBe('Ana Souza')
    expect(names.get('Ana Lima\tana.lima@x.com')).toBe('Ana Lima')
    expect(names.get('carol-dev\tcarol@x.com')).toBe(names.get('Carol\tcarol@x.com'))
  })
})

describe('rankOwners', () => {
  it('weighs authorship by file risk, prefers the changed lines, skips PR authors and bots, and ranks inactive people lower', () => {
    const ranked = rankOwners(
      [
        { path: 'src/core.ts', weight: 30, whole: new Map([['Ana', 80], ['Bob', 20]]), touched: new Map([['Bob', 10]]) },
        { path: 'src/ui.ts', weight: 5, whole: new Map([['Carol', 50], ['dependabot[bot]', 50]]), touched: null },
        { path: 'src/pr.ts', weight: 5, whole: new Map([['Dave', 10]]), touched: null },
      ],
      new Set(['Dave']),
      new Set(['Bob', 'Carol']),
    )
    expect(ranked.reviewers.map((r) => [r.name, r.score, r.active])).toEqual([
      ['Bob', 45],
      ['Carol', 13],
      ['Ana', 30],
    ].map(([n, s]) => [n, s, n !== 'Ana']))
    expect(ranked.reviewers[0]?.files).toEqual([{ path: 'src/core.ts', share: 60 }])
    expect(ranked.files).toEqual([{ path: 'src/core.ts', owner: 'Bob', share: 60 }, { path: 'src/ui.ts', owner: 'Carol', share: 100 }])
  })
})

describe('farol reviewers', () => {
  it('blames the merge-base for an analyzed PR and adds the result to the comment and the HTML', async () => {
    const s = createScenarioRepo('05-shared-component')
    repos.push(s)
    // The PR's commit is Bob's: the base code is farol's (an old commit, so inactive).
    s.repo.git('commit', '-q', '--amend', '--no-edit', '--author=Bob <bob@example.com>')
    const { output } = await analyzeRepo(s.repo, { head: s.repo.sha('HEAD') })
    const json = join(s.repo.dir, 'farol.json')
    writeFileSync(json, JSON.stringify(output))
    const ctx = await loadContext({ config: 'farol.config.json', cwd: s.repo.dir, verbose: false })
    const reviewers = await runReviewers(ctx, { in: json })
    expect(reviewers.prAuthors).toEqual(['Bob'])
    expect(reviewers.reviewers.map((r) => [r.name, r.active])).toEqual([['farol', false]])
    expect(reviewers.files.map((f) => [f.path, f.owner, f.share])).toEqual([['src/components/Card.tsx', 'farol', 100]])
    const path = join(s.repo.dir, 'reviewers.json')
    writeFileSync(path, JSON.stringify(reviewers))
    const merged = withReviewers(output, path)
    expect(renderReport(merged)).toContain('**Suggested reviewers:** farol (')
    const html = renderHtml(merged)
    expect((workbenchOf(html).D.reviewers as { name: string; files: string[] }[])[0]).toMatchObject({ name: 'farol', files: ['src/components/Card.tsx'] })
    expect(detailsOf(html)).toContain('farol')
  })
})
