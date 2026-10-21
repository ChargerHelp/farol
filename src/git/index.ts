import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildChangedFiles, parseContextDiff, parseNameStatus, parseUnifiedDiff, type ContextPatch } from './parse.js'
import { GitError, runGit, runGitBuffer } from './exec.js'
import type { ChangedFile, MergeCommit } from './types.js'

export { GitError } from './exec.js'
export type * from './types.js'

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--diff-algorithm=myers', '-M', '--src-prefix=a/', '--dst-prefix=b/']

export async function repoRoot(cwd: string): Promise<string> {
  return (await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim()
}

/** Resolves a ref to a full commit SHA, with a message that says what to do when it does not exist. */
export async function resolveCommit(cwd: string, ref: string): Promise<string> {
  try {
    return (await runGit(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim()
  } catch (error) {
    if (error instanceof GitError) throw new GitError(`ref "${ref}" is not a commit in this repository; fetch it (actions/checkout with fetch-depth: 0) or check the name`, error.args, error.stderr)
    throw error
  }
}

export async function mergeBase(cwd: string, base: string, head: string): Promise<string> {
  try {
    return (await runGit(cwd, ['merge-base', base, head])).trim()
  } catch (error) {
    if (error instanceof GitError) throw new GitError(`no merge-base between ${base} and ${head}; the history is probably shallow (use fetch-depth: 0)`, error.args, error.stderr)
    throw error
  }
}

/** Changed files between two commits, with normalized added/removed lines. */
export async function diffFiles(cwd: string, from: string, to: string): Promise<ChangedFile[]> {
  const [nameStatus, patch] = await Promise.all([
    runGit(cwd, ['diff', ...DIFF_FLAGS, '--name-status', '-z', from, to, '--']),
    runGit(cwd, ['diff', ...DIFF_FLAGS, '--unified=0', from, to, '--']),
  ])
  return buildChangedFiles(parseNameStatus(nameStatus), parseUnifiedDiff(patch))
}

/** Content of a file at a ref, or null when the file does not exist there. */
export async function showFile(cwd: string, ref: string, path: string): Promise<string | null> {
  try {
    return await runGit(cwd, ['show', `${ref}:${path}`])
  } catch (error) {
    if (error instanceof GitError && /does not exist|exists on disk, but not in|bad revision|invalid object name/i.test(error.stderr)) return null
    throw error
  }
}

/** Every file path (repo-relative) in the tree of a ref. */
export async function listFiles(cwd: string, ref: string): Promise<string[]> {
  const out = await runGit(cwd, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', ref])
  return out.split('\0').filter((p) => p !== '')
}

/** Reads many files of a ref in one `git cat-file --batch` process. Missing paths are left out. */
export async function readFiles(cwd: string, ref: string, paths: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (paths.length === 0) return result
  const input = paths.map((p) => `${ref}:${p}\n`).join('')
  const out = await runGitBuffer(cwd, ['cat-file', '--batch'], input)
  let offset = 0
  for (const path of paths) {
    const newline = out.indexOf(10, offset)
    if (newline === -1) throw new Error(`unexpected end of git cat-file output while reading ${path}`)
    const header = out.subarray(offset, newline).toString('utf8')
    offset = newline + 1
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) continue
    const size = Number(header.split(' ')[2])
    if (!Number.isFinite(size)) throw new Error(`unexpected git cat-file header "${header}"`)
    if (header.split(' ')[1] === 'blob') result.set(path, out.subarray(offset, offset + size).toString('utf8'))
    offset += size + 1
  }
  return result
}

/** Merge commits reachable by first parent from `branch` since `since`, oldest first. */
export async function listMerges(cwd: string, branch: string, since: string, firstParentCommits: boolean): Promise<MergeCommit[]> {
  const args = ['log', '--first-parent', `--since=${since}`, '--format=%H%x00%P%x00%cI%x00%s', '--end-of-options', branch]
  if (!firstParentCommits) args.splice(1, 0, '--merges')
  const out = await runGit(cwd, args)
  const merges: MergeCommit[] = []
  for (const line of out.split('\n')) {
    if (line === '') continue
    const [sha = '', parents = '', date = '', subject = ''] = line.split('\0')
    const firstParent = parents.split(' ')[0]
    if (firstParent === undefined || firstParent === '') continue
    merges.push({ sha, firstParent, date, subject })
  }
  return merges.reverse()
}

/** URL of the `origin` remote, or null when there is none. */
export async function originUrl(cwd: string): Promise<string | null> {
  try {
    const url = (await runGit(cwd, ['config', '--get', 'remote.origin.url'])).trim()
    return url === '' ? null : url
  } catch {
    // `git config --get` exits 1 when the key is unset: that is the "no remote" answer, not a failure.
    return null
  }
}

/**
 * Writes the tree of a commit to `dir` (which must exist and be empty): `git archive` to a tar file, then `tar -x`.
 * Used for toolchains that read files from disk (Go); nothing in the tree is executed.
 */
export async function exportTree(cwd: string, ref: string, dir: string): Promise<void> {
  const tarFile = join(dir, '.farol-tree.tar')
  await runGit(cwd, ['archive', '--format=tar', `--output=${tarFile}`, ref])
  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['-xf', tarFile, '-C', dir], { maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new GitError(`tar -xf failed: ${stderr.trim() || error.message}`, ['archive', ref], stderr))
      else resolve()
    })
  })
  rmSync(tarFile)
}

/** Whether `ancestor` is an ancestor of (or equal to) `commit`. */
export async function isAncestor(cwd: string, ancestor: string, commit: string): Promise<boolean> {
  try {
    await runGit(cwd, ['merge-base', '--is-ancestor', ancestor, commit])
    return true
  } catch (error) {
    if (error instanceof GitError) return false
    throw error
  }
}

/** Author names of the commits of a revision range or ref (optionally touching one path), newest first. */
export async function logAuthors(cwd: string, revision: string, options: { path?: string; max?: number; since?: string } = {}): Promise<string[]> {
  const args = ['log', '--no-merges', '--format=%aN', ...(options.max !== undefined ? [`--max-count=${options.max}`] : []), ...(options.since !== undefined ? [`--since=${options.since}`] : []), revision, '--', ...(options.path !== undefined ? [options.path] : [])]
  return (await runGit(cwd, args)).split('\n').filter((l) => l.trim() !== '')
}

/** Diff with context lines of some files, for display (paths are passed in batches to keep command lines short). */
export async function contextDiff(cwd: string, from: string, to: string, paths: readonly string[], context = 3): Promise<ContextPatch[]> {
  const out: ContextPatch[] = []
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    out.push(...parseContextDiff(await runGit(cwd, ['diff', ...DIFF_FLAGS, `--unified=${context}`, from, to, '--', ...batch])))
  }
  return out
}

/** SHA of the tree of a commit: identical trees (same files, same contents) give the same SHA. */
export async function treeOf(cwd: string, commit: string): Promise<string> {
  return (await runGit(cwd, ['rev-parse', `${commit}^{tree}`])).trim()
}
