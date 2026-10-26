import { describe, expect, it } from 'vitest'
import { parseContextDiff } from '../../src/git/parse.js'
import { limitDiffs } from '../../src/review/diffs.js'

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
})
