import { describe, expect, it } from 'vitest'
import { buildChangedFiles, normalizeHunk, normalizeLine, parseNameStatus, parseUnifiedDiff, unquoteGitPath } from '../../src/git/parse.js'

describe('parseNameStatus', () => {
  it('parses the four statuses, renames and type changes', () => {
    const out = ['A', 'src/new.ts', 'M', 'src/mod.ts', 'D', 'src/gone.ts', 'R087', 'src/old.ts', 'src/renamed.ts', 'T', 'src/link', ''].join('\0')
    expect(parseNameStatus(out)).toEqual([
      { status: 'added', path: 'src/new.ts' },
      { status: 'modified', path: 'src/mod.ts' },
      { status: 'deleted', path: 'src/gone.ts' },
      { status: 'renamed', path: 'src/renamed.ts', oldPath: 'src/old.ts' },
      { status: 'modified', path: 'src/link' },
    ])
  })

  it('rejects unknown statuses instead of guessing', () => {
    expect(() => parseNameStatus('X\0a\0')).toThrow(/unsupported git status/)
  })
})

describe('unquoteGitPath', () => {
  it('handles plain, escaped and octal paths', () => {
    expect(unquoteGitPath('src/a.ts')).toBe('src/a.ts')
    expect(unquoteGitPath('"src/a\\tb.ts"')).toBe('src/a\tb.ts')
    expect(unquoteGitPath('"src/\\303\\251.ts"')).toBe('src/é.ts')
    expect(unquoteGitPath('"a\\"b"')).toBe('a"b')
  })
})

const SAMPLE = `diff --git a/src/mod.ts b/src/mod.ts
index 1111111..2222222 100644
--- a/src/mod.ts
+++ b/src/mod.ts
@@ -3 +3,2 @@ export const a = 1
-const b = 2
+const b = 3
+const c = 4
@@ -10,0 +12 @@ function f() {
+  return 1
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1
+export const y = 2
\\ No newline at end of file
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const z = 1
diff --git a/src/old.ts b/src/renamed.ts
similarity index 100%
rename from src/old.ts
rename to src/renamed.ts
diff --git a/img/logo.png b/img/logo.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/img/logo.png differ
`

describe('parseUnifiedDiff', () => {
  const patches = parseUnifiedDiff(SAMPLE)

  it('numbers removed lines in the base and added lines in the head', () => {
    const mod = patches.find((p) => p.path === 'src/mod.ts')
    expect(mod?.hunks).toEqual([
      { oldStart: 3, newStart: 3, removed: [{ line: 3, text: 'const b = 2' }], added: [{ line: 3, text: 'const b = 3' }, { line: 4, text: 'const c = 4' }] },
      { oldStart: 10, newStart: 12, removed: [], added: [{ line: 12, text: '  return 1' }] },
    ])
  })

  it('handles new, deleted, pure renames and binary files', () => {
    expect(patches.map((p) => [p.path, p.oldPath, p.binary])).toEqual([
      ['src/mod.ts', undefined, false],
      ['src/new.ts', undefined, false],
      ['src/gone.ts', undefined, false],
      ['src/renamed.ts', 'src/old.ts', false],
      ['img/logo.png', undefined, true],
    ])
    expect(patches[1]?.hunks[0]?.added.map((l) => l.text)).toEqual(['export const x = 1', 'export const y = 2'])
    expect(patches[2]?.hunks[0]?.removed).toEqual([{ line: 1, text: 'export const z = 1' }])
  })
})

describe('normalization', () => {
  it('ignores trailing commas and whitespace', () => {
    expect(normalizeLine("  { path: 'a' },  ")).toBe(normalizeLine("{ path:   'a' }"))
    expect(normalizeLine('foo(a, b)')).not.toBe(normalizeLine('foo(a,b)'))
  })

  it('drops pairs that only gained a trailing comma (adding an item to a list)', () => {
    const n = normalizeHunk({
      oldStart: 5,
      newStart: 5,
      removed: [{ line: 5, text: "  { path: 'a', element: <A /> }" }],
      added: [
        { line: 5, text: "  { path: 'a', element: <A /> }," },
        { line: 6, text: "  { path: 'b', element: <B /> }" },
      ],
    })
    expect(n.removed).toEqual([])
    expect(n.added).toEqual([{ line: 6, text: "  { path: 'b', element: <B /> }" }])
  })

  it('keeps real modifications and respects order', () => {
    const n = normalizeHunk({
      oldStart: 1,
      newStart: 1,
      removed: [
        { line: 1, text: 'a' },
        { line: 2, text: 'b' },
      ],
      added: [
        { line: 1, text: 'b' },
        { line: 2, text: 'a' },
      ],
    })
    // "a" matches the second added line; "b" can no longer match the first one (order is kept).
    expect(n.removed).toEqual([{ line: 2, text: 'b' }])
    expect(n.added).toEqual([{ line: 1, text: 'b' }])
  })

  it('builds sorted changed files with normalized lines', () => {
    const files = buildChangedFiles(
      [
        { status: 'modified', path: 'z.ts' },
        { status: 'added', path: 'a.ts' },
      ],
      parseUnifiedDiff(`diff --git a/z.ts b/z.ts
--- a/z.ts
+++ b/z.ts
@@ -1 +1,2 @@
-x
+x,
+y
diff --git a/a.ts b/a.ts
--- /dev/null
+++ b/a.ts
@@ -0,0 +1 @@
+n
`),
    )
    expect(files).toEqual([
      { path: 'a.ts', status: 'added', added: [{ line: 1, text: 'n' }], removed: [], binary: false },
      { path: 'z.ts', status: 'modified', added: [{ line: 2, text: 'y' }], removed: [], binary: false },
    ])
  })
})
