import { compareStrings } from '../output/order.js'
import type { UsageIssue } from './usage.js'

/** Code that is not the project's: dependencies, the runtime, generated bundles of other packages. */
const FOREIGN = ['node_modules', 'site-packages', 'dist-packages', '.venv', 'venv', '.pnpm', 'vendor', 'go/src', 'go/pkg/mod']

/** Path segments of a reported file, without URL schemes, `./` and `../`; null for files that are not the project's. */
export function reportedSegments(file: string): string[] | null {
  let path = file.replaceAll('\\', '/')
  if (path.startsWith('node:') || path.startsWith('<') || path.startsWith('internal/')) return null
  const scheme = path.indexOf('://')
  if (scheme >= 0) path = path.slice(scheme + 3)
  const query = path.search(/[?#]/)
  if (query >= 0) path = path.slice(0, query)
  const segments = path.split('/').filter((s) => s !== '' && s !== '.' && s !== '..')
  const joined = `/${segments.join('/')}/`
  if (FOREIGN.some((f) => joined.includes(`/${f}/`))) return null
  return segments.length === 0 ? null : segments
}

/** The file name without its extension: `x.service.js` and `x.service.ts` are the same module (compiled and source). */
function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Trailing segments two paths share, comparing the file names without extensions. */
function sharedSuffix(a: readonly string[], b: readonly string[]): number {
  let n = 0
  while (n < a.length && n < b.length) {
    const x = a[a.length - 1 - n] ?? ''
    const y = b[b.length - 1 - n] ?? ''
    if (n === 0 ? stem(x) !== stem(y) : x !== y) break
    n++
  }
  return n
}

/**
 * The changed file a reported file is: the one sharing the longest path suffix, when it shares at least three
 * segments, or the whole of either path and at least two. `dist/modules/a/b.service.js` is `src/modules/a/b.service.ts`;
 * `dist/main.js` is nobody (a bundle). Ties are ambiguous: no file.
 */
export function matchReportedFile(file: string, changed: readonly string[]): string | null {
  const segments = reportedSegments(file)
  if (segments === null) return null
  let best = 0
  let winners: string[] = []
  for (const path of changed) {
    const own = path.split('/')
    const n = sharedSuffix(segments, own)
    const enough = n >= 3 || (n >= 2 && (n === segments.length || n === own.length))
    if (!enough || n < best) continue
    if (n > best) {
      best = n
      winners = [path]
    } else winners.push(path)
  }
  return winners.length === 1 ? (winners[0] ?? null) : null
}

/** Error Tracking issues thrown in the changed files, grouped by file, most errors first. */
export function errorFiles(changed: readonly string[], issues: readonly UsageIssue[]): { path: string; errors: number; issues: number; types: string[]; issueIds: string[]; track?: 'rum' | 'trace' }[] {
  const byFile = new Map<string, { errors: number; issues: number; types: Set<string>; ids: Set<string>; tracks: Set<string> }>()
  for (const issue of issues) {
    const path = matchReportedFile(issue.file, changed)
    if (path === null) continue
    const entry = byFile.get(path) ?? { errors: 0, issues: 0, types: new Set<string>(), ids: new Set<string>(), tracks: new Set<string>() }
    entry.errors += issue.count
    entry.issues++
    if (issue.type !== '') entry.types.add(issue.type)
    if (issue.id !== undefined) entry.ids.add(issue.id)
    if (issue.track !== undefined) entry.tracks.add(issue.track)
    byFile.set(path, entry)
  }
  return [...byFile]
    .map(([path, e]) => {
      const track = e.tracks.size === 1 ? ([...e.tracks][0] as 'rum' | 'trace') : undefined
      return { path, errors: Math.round(e.errors), issues: e.issues, types: [...e.types].sort(compareStrings), issueIds: [...e.ids].sort(compareStrings).slice(0, 20), ...(track === undefined ? {} : { track }) }
    })
    .sort((a, b) => b.errors - a.errors || compareStrings(a.path, b.path))
}
