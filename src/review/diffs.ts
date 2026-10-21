import type { ContextPatch } from '../git/parse.js'

export interface FileDiff {
  path: string
  hunks: ContextPatch['hunks']
  /** Lines were left out (per-file or total limit): the full diff is on GitHub. */
  truncated: boolean
}

/** Lines kept per file and in total: the HTML report stays a reasonable single file. */
export const MAX_DIFF_LINES_PER_FILE = 1000
export const MAX_DIFF_LINES = 8000

/**
 * Diffs of the wanted files in the given order, cut at the per-file and total limits. A hunk that does not fit is
 * cut, not dropped: a new file is one hunk, and the riskiest one must still show its first lines.
 */
export function limitDiffs(patches: readonly ContextPatch[], order: readonly string[], perFile = MAX_DIFF_LINES_PER_FILE, total = MAX_DIFF_LINES): FileDiff[] {
  const byPath = new Map(patches.map((p) => [p.path, p]))
  const out: FileDiff[] = []
  let used = 0
  for (const path of order) {
    const patch = byPath.get(path)
    if (!patch) continue
    const hunks: ContextPatch['hunks'] = []
    let lines = 0
    let truncated = false
    for (const hunk of patch.hunks) {
      const room = Math.min(perFile - lines, total - used - lines)
      if (hunk.lines.length > room) {
        if (room > 0) {
          hunks.push({ ...hunk, lines: hunk.lines.slice(0, room) })
          lines += room
        }
        truncated = true
        break
      }
      hunks.push(hunk)
      lines += hunk.lines.length
    }
    used += lines
    out.push({ path, hunks, truncated })
  }
  return out
}
