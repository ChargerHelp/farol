import type { ReportHead } from '../../src/signals/paths.js'

/** The head commit as a report reader sees it: the changed files, and whether a path is a file (changed or `other`). */
export function reportHead(changed: string[], other: string[] = []): ReportHead {
  return { changed, exists: (path) => [...changed, ...other].includes(path) }
}
