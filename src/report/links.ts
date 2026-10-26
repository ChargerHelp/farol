import { createHash } from 'node:crypto'
import type { Output } from '../output/schema.js'

/** Where file links point: the PR (or compare) diff for changed files, the analyzed commit for the others. */
export interface LinkTarget {
  /** owner/name */
  repo: string | null
  pr: number | null
  /** GitHub (or GitHub Enterprise) web URL. */
  serverUrl?: string
}

export interface Linker {
  /** URL of a file: its diff when the PR changed it, its content at the analyzed commit otherwise. */
  file(path: string): string | null
  /** URL of a line or a line range of a file (head side of the diff for changed files). */
  lines(path: string, start: number, end?: number): string | null
  /** URL of the pull request (its conversation, where a review comment goes), when there is one. */
  page?(): string | null
}

const NO_LINKS: Linker = { file: () => null, lines: () => null }

/** GitHub's diff anchor of a file: `diff-` + SHA-256 of its path. */
export function diffAnchor(path: string): string {
  return `diff-${createHash('sha256').update(path).digest('hex')}`
}

/** Builds file and line links for an analyze result; without a repository every link is null. */
export function createLinker(output: Output, target: LinkTarget): Linker {
  if (target.repo === null || !target.repo.includes('/')) return NO_LINKS
  const server = (target.serverUrl ?? 'https://github.com').replace(/\/+$/, '')
  const base = `${server}/${target.repo}`
  const head = output.head.sha ?? output.head.ref
  const from = output.mergeBase ?? output.base.sha ?? output.base.ref
  // Incremental reports link to the compare view of the new commits only (the PR page shows the whole PR).
  const diffPage = target.pr !== null && output.incremental === undefined ? `${base}/pull/${target.pr}/files` : `${base}/compare/${from}...${head}`
  const changed = new Map<string, 'added' | 'modified' | 'deleted' | 'renamed'>()
  for (const f of output.files) changed.set(f.path, f.status)
  for (const p of output.ignoredFiles) if (!changed.has(p)) changed.set(p, 'modified')
  const blob = (path: string): string => `${base}/blob/${head}/${path.split('/').map(encodeURIComponent).join('/')}`
  return {
    page: () => (target.pr !== null ? `${base}/pull/${target.pr}` : null),
    file: (path) => (changed.has(path) ? `${diffPage}#${diffAnchor(path)}` : blob(path)),
    lines: (path, start, end) => {
      const status = changed.get(path)
      if (status === undefined) return `${blob(path)}#L${start}${end !== undefined && end !== start ? `-L${end}` : ''}`
      // Deleted files only have a left (base) side in the diff.
      const side = status === 'deleted' ? 'L' : 'R'
      return `${diffPage}#${diffAnchor(path)}${side}${start}${end !== undefined && end !== start ? `-${side}${end}` : ''}`
    },
  }
}
