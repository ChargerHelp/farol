import { describe, expect, it } from 'vitest'
import { parseContextDiff } from '../../src/git/parse.js'
import { limitDiffs } from '../../src/review/diffs.js'
import { diffBlock, languageOf } from '../../src/report/html-diff.js'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURES_DIR } from '../helpers/repo.js'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@ export function a() {',
  ' const x = 1',
  '-const y = 2',
  '+const y = 3',
  '+const z = 4',
  ' export { x }',
  '\\ No newline at end of file',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -10,1 +10,1 @@',
  '-old',
  '+new',
].join('\n')

describe('inline diffs', () => {
  it('parses a diff with context into hunks of raw lines', () => {
    const patches = parseContextDiff(PATCH)
    expect(patches.map((p) => [p.path, p.hunks.length, p.hunks[0]?.newStart, p.hunks[0]?.lines.length])).toEqual([
      ['src/a.ts', 1, 1, 5],
      ['src/b.ts', 1, 10, 2],
    ])
  })

  it('keeps hunks up to the per-file and total limits, in the given order, cutting the hunk that does not fit', () => {
    const patches = parseContextDiff(PATCH)
    expect(limitDiffs(patches, ['src/b.ts', 'src/a.ts'], 400, 3).map((d) => [d.path, d.hunks.map((h) => h.lines.length), d.truncated])).toEqual([
      ['src/b.ts', [2], false],
      ['src/a.ts', [1], true],
    ])
    // A new file is one hunk: over the per-file limit it shows its first lines instead of nothing.
    expect(limitDiffs(patches, ['src/a.ts'], 2, 100).map((d) => [d.hunks.map((h) => h.lines), d.truncated])).toEqual([[[[' const x = 1', '-const y = 2']], true]])
    expect(limitDiffs(patches, ['src/b.ts', 'src/a.ts'], 400, 2).map((d) => [d.path, d.hunks.length, d.truncated])).toEqual([
      ['src/b.ts', 1, false],
      ['src/a.ts', 0, true],
    ])
  })

  it('renders added lines no test runs and lines with findings', () => {
    const o: Output = OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, 'signals-coverage-lint', 'expected.json'), 'utf8')))
    const file = o.signals.coverage.files.find((f) => f.uncovered.length > 0)
    expect(file).toBeDefined()
    const line = file?.uncovered[0]?.start ?? 1
    const withDiff: Output = { ...o, diffs: [{ path: file?.path ?? '', hunks: [{ header: `@@ -${line},1 +${line},1 @@`, oldStart: line, newStart: line, lines: ['-a', '+b'] }], truncated: true }] }
    const html = diffBlock(withDiff, file?.path ?? '', 'https://example.com/diff')
    expect(html).toContain('Show diff (+1 −1)')
    expect(html).toContain('class="add untested')
    expect(html).toContain('Full diff on GitHub')
    expect(diffBlock(o, file?.path ?? '', null)).toBe('')
  })

  it('picks the highlight.js language from the file name', () => {
    expect(languageOf('src/a.tsx')).toBe('typescript')
    expect(languageOf('cmd/api/main.go')).toBe('go')
    expect(languageOf('services/api/Dockerfile.dev')).toBe('bash')
    expect(languageOf('.env.example')).toBe('bash')
    expect(languageOf('LICENSE')).toBeUndefined()
  })
})
