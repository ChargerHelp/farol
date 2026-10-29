import { isAbsolute, posix } from 'node:path'

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.go', '.py'])

/** Code files (not declarations): the only files coverage and suppressions apply to (Go files have their own readers). */
export function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(posix.extname(path)) && !path.endsWith('.d.ts')
}

/**
 * Repo-relative path of a report entry. Absolute paths are made relative to the repository root; relative paths
 * are taken relative to the project directory (where the tests and the linter run). Backslashes become `/`.
 * `canonical` resolves symlinks (reports may use a symlinked path, git always gives the real one).
 */
export function reportPathToRepo(raw: string, repoRoot: string, projectPrefix: string, canonical: (path: string) => string = (x) => x): string | undefined {
  const p = canonical(raw).replaceAll('\\', '/')
  const root = repoRoot.replaceAll('\\', '/')
  if (isAbsolute(p) || /^[A-Za-z]:\//.test(p)) {
    if (!p.startsWith(`${root}/`)) return undefined
    return p.slice(root.length + 1)
  }
  return posix.normalize(posix.join(projectPrefix, p))
}

/** The head commit as a report reader needs it: the changed files (repo-relative) and whether a path is a file. */
export interface ReportHead {
  changed: readonly string[]
  exists: (path: string) => boolean
}

/**
 * The first report path written from another folder than the project directory: read from the project directory it
 * names no head file, but read as written it names a changed file of the project (from the repository root, a parent
 * or a child folder). Checking the head files keeps a project folder named like the project (`app/app/page.tsx`
 * written as `app/page.tsx`) valid.
 */
export function firstPathFromOtherFolder(paths: readonly string[], repoRoot: string, projectPrefix: string, head: ReportHead, canonical?: (path: string) => string): string | undefined {
  const inProject = (path: string): boolean => projectPrefix === '' || path.startsWith(`${projectPrefix}/`)
  return paths.find((raw) => {
    const asWritten = reportPathToRepo(raw, repoRoot, '', canonical)
    const mapped = reportPathToRepo(raw, repoRoot, projectPrefix, canonical)
    if (asWritten === undefined || mapped === undefined) return false
    const namesChangedFile = head.changed.some((c) => c !== mapped && inProject(c) && (c === asWritten || c.endsWith(`/${asWritten}`)))
    return namesChangedFile && !head.exists(mapped)
  })
}

/** Normalized relative paths that leave the repository start with `..`. */
const climbsOut = (path: string): boolean => path === '..' || path.startsWith('../')

/**
 * A path of a report written in another checkout (a container, another runner folder): the report names files but
 * none of them is in the repository. Undefined when at least one path is in the repository (outside paths, such as
 * installed packages, are then left out) or the report names no file.
 */
export function firstPathFromOtherCheckout(paths: readonly string[], repoRoot: string, projectPrefix: string, canonical?: (path: string) => string): string | undefined {
  const named = paths.filter((raw) => raw.trim() !== '')
  const inRepo = (raw: string): boolean => {
    const path = reportPathToRepo(raw, repoRoot, projectPrefix, canonical)
    return path !== undefined && !climbsOut(path)
  }
  return named.some(inRepo) ? undefined : named[0]
}

/** Groups sorted line numbers into contiguous ranges. */
export function toRanges(lines: readonly number[]): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  for (const line of [...lines].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1]
    if (last && line === last.end + 1) last.end = line
    else if (!last || line > last.end) ranges.push({ start: line, end: line })
  }
  return ranges
}
