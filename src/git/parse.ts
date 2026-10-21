import { compareStrings } from '../output/order.js'
import type { ChangedFile, DiffLine, FilePatch, Hunk, NameStatusEntry } from './types.js'

/** Parses `git diff --name-status -M -z` output. */
export function parseNameStatus(output: string): NameStatusEntry[] {
  const parts = output.split('\0')
  const entries: NameStatusEntry[] = []
  let i = 0
  while (i < parts.length) {
    const code = parts[i]
    if (code === undefined || code === '') {
      i++
      continue
    }
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i + 1]
      const path = parts[i + 2]
      if (oldPath === undefined || path === undefined) throw new Error(`malformed name-status entry: ${code}`)
      // A copy keeps the original in place: for the analysis it is a new file.
      entries.push(letter === 'R' ? { status: 'renamed', path, oldPath } : { status: 'added', path })
      i += 3
      continue
    }
    const path = parts[i + 1]
    if (path === undefined) throw new Error(`malformed name-status entry: ${code}`)
    const status = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : letter === 'M' || letter === 'T' ? 'modified' : undefined
    if (status === undefined) throw new Error(`unsupported git status "${code}" for ${path}`)
    entries.push({ status, path })
    i += 2
  }
  return entries
}

/** Undoes git's C-style quoting of paths ("a\tb" → a<TAB>b). */
export function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw
  const body = raw.slice(1, -1)
  const bytes: number[] = []
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? ''
    if (ch !== '\\') {
      for (const b of Buffer.from(ch, 'utf8')) bytes.push(b)
      continue
    }
    const next = body[i + 1] ?? ''
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8))
      i += 3
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0))
      i += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function stripPrefix(raw: string, prefix: string): string {
  const path = unquoteGitPath(raw)
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/** Path from `diff --git a/P b/P` when both sides are equal (binary files and mode-only changes). */
function pathFromHeader(rest: string): string | undefined {
  const middle = (rest.length - 1) / 2
  if (!Number.isInteger(middle)) return undefined
  const left = rest.slice(0, middle)
  const right = rest.slice(middle + 1)
  if (left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2)) return left.slice(2)
  return undefined
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parses `git diff --unified=0` output into one patch per file. */
export function parseUnifiedDiff(output: string): FilePatch[] {
  const patches: FilePatch[] = []
  let current: { header?: string; oldPath?: string; newPath?: string; binary: boolean; hunks: Hunk[] } | undefined
  let hunk: Hunk | undefined
  let oldLine = 0
  let newLine = 0

  const flush = (): void => {
    if (!current) return
    const path = current.newPath ?? current.oldPath ?? (current.header ? pathFromHeader(current.header) : undefined)
    if (path === undefined) throw new Error(`cannot determine the path of a diff block: diff --git ${current.header ?? ''}`)
    const patch: FilePatch = { path, binary: current.binary, hunks: current.hunks }
    if (current.oldPath !== undefined && current.newPath !== undefined && current.oldPath !== current.newPath) patch.oldPath = current.oldPath
    patches.push(patch)
  }

  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      current = { header: line.slice('diff --git '.length), binary: false, hunks: [] }
      hunk = undefined
      continue
    }
    if (!current) continue
    if (hunk) {
      if (line.startsWith('+')) {
        hunk.added.push({ line: newLine++, text: line.slice(1) })
        continue
      }
      if (line.startsWith('-')) {
        hunk.removed.push({ line: oldLine++, text: line.slice(1) })
        continue
      }
      if (line.startsWith('\\')) continue
    }
    const match = HUNK_HEADER.exec(line)
    if (match) {
      oldLine = Number(match[1])
      newLine = Number(match[3])
      hunk = { oldStart: oldLine, newStart: newLine, removed: [], added: [] }
      current.hunks.push(hunk)
      continue
    }
    hunk = undefined
    if (line.startsWith('--- ')) {
      const raw = line.slice(4)
      if (raw !== '/dev/null') current.oldPath = stripPrefix(raw, 'a/')
    } else if (line.startsWith('+++ ')) {
      const raw = line.slice(4)
      if (raw !== '/dev/null') current.newPath = stripPrefix(raw, 'b/')
    } else if (line.startsWith('rename from ')) {
      current.oldPath = unquoteGitPath(line.slice('rename from '.length))
    } else if (line.startsWith('rename to ')) {
      current.newPath = unquoteGitPath(line.slice('rename to '.length))
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.binary = true
    }
  }
  flush()
  return patches
}

/** Text used to compare a removed line with an added one: trailing comma and whitespace differences are ignored. */
export function normalizeLine(text: string): string {
  let t = text.trim()
  if (t.endsWith(',')) t = t.slice(0, -1).trimEnd()
  return t.replace(/\s+/g, ' ')
}

/**
 * Drops removed/added pairs of a hunk that differ only by a trailing comma or whitespace.
 * Pairs are matched greedily in order, so the relative order of lines is respected.
 */
export function normalizeHunk(hunk: Hunk): { removed: DiffLine[]; added: DiffLine[] } {
  const matchedAdded = new Set<number>()
  const removed: DiffLine[] = []
  let cursor = 0
  for (const r of hunk.removed) {
    const key = normalizeLine(r.text)
    let found = -1
    for (let k = cursor; k < hunk.added.length; k++) {
      const a = hunk.added[k]
      if (a !== undefined && normalizeLine(a.text) === key) {
        found = k
        break
      }
    }
    if (found === -1) {
      removed.push(r)
    } else {
      matchedAdded.add(found)
      cursor = found + 1
    }
  }
  const added = hunk.added.filter((_, k) => !matchedAdded.has(k))
  return { removed, added }
}

/** Combines name-status entries with parsed patches into normalized changed files, sorted by path. */
export function buildChangedFiles(entries: NameStatusEntry[], patches: FilePatch[]): ChangedFile[] {
  const byPath = new Map(patches.map((p) => [p.path, p]))
  const files = entries.map((entry): ChangedFile => {
    const patch = byPath.get(entry.path)
    const added: DiffLine[] = []
    const removed: DiffLine[] = []
    for (const hunk of patch?.hunks ?? []) {
      const n = normalizeHunk(hunk)
      added.push(...n.added)
      removed.push(...n.removed)
    }
    const file: ChangedFile = { path: entry.path, status: entry.status, added, removed, binary: patch?.binary ?? false }
    if (entry.oldPath !== undefined) file.oldPath = entry.oldPath
    return file
  })
  return files.sort((a, b) => compareStrings(a.path, b.path))
}

/** One file of a diff with context lines: hunks keep their header and their raw lines (' ', '+', '-' prefixes). */
export interface ContextPatch {
  path: string
  hunks: { header: string; oldStart: number; newStart: number; lines: string[] }[]
}

/** Parses `git diff --unified=N` output for display (binary files have no hunks). */
export function parseContextDiff(output: string): ContextPatch[] {
  const patches: ContextPatch[] = []
  let current: ContextPatch | undefined
  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { path: pathFromHeader(line.slice('diff --git '.length)) ?? '', hunks: [] }
      patches.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('+++ ') && current.hunks.length === 0) {
      const target = line.slice(4)
      if (target.startsWith('b/')) current.path = target.slice(2)
      continue
    }
    if (line.startsWith('--- ') && current.hunks.length === 0) continue
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header) {
      current.hunks.push({ header: line, oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] })
      continue
    }
    const hunk = current.hunks[current.hunks.length - 1]
    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) hunk.lines.push(line)
  }
  return patches.filter((p) => p.path !== '')
}
