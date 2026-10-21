import { runGit } from './exec.js'

/** An author identity: `name<TAB>email` (the email may be empty). */
export type Identity = string

/** Lines per author identity in `git blame --line-porcelain` output (`author` then `author-mail` per line). */
export function parseBlameAuthors(output: string): Map<Identity, number> {
  const lines = new Map<Identity, number>()
  let name = ''
  for (const line of output.split('\n')) {
    if (line.startsWith('author ')) name = line.slice('author '.length).trim()
    else if (line.startsWith('author-mail ')) {
      const email = line.slice('author-mail '.length).trim().replace(/^<|>$/g, '')
      if (name !== '' && name !== 'Not Committed Yet') lines.set(`${name}\t${email}`, (lines.get(`${name}\t${email}`) ?? 0) + 1)
      name = ''
    }
  }
  return lines
}

/** Lines added per author identity in `git log --numstat --format=@%aN%x09%aE` output (binary files count nothing). */
export function parseNumstatAuthors(output: string): Map<Identity, number> {
  const lines = new Map<string, number>()
  let author = ''
  for (const line of output.split('\n')) {
    if (line.startsWith('@')) author = line.slice(1)
    else if (author !== '' && /^\d+\t/.test(line)) lines.set(author, (lines.get(author) ?? 0) + Number(line.split('\t')[0]))
  }
  return lines
}

/**
 * Authors of the lines of a file at a revision (whitespace changes ignored, .mailmap applied); `ranges` (1-based,
 * inclusive, within the file at that revision) limit it to some lines. An empty map when the file does not exist there.
 */
export async function blameAuthors(cwd: string, revision: string, path: string, ranges: readonly [number, number][] = []): Promise<Map<Identity, number>> {
  const listed = await runGit(cwd, ['ls-tree', '--name-only', revision, '--', path])
  if (listed.trim() === '') return new Map()
  const limits = ranges.flatMap(([from, to]) => ['-L', `${from},${to}`])
  return parseBlameAuthors(await runGit(cwd, ['-c', 'log.mailmap=true', 'blame', '--line-porcelain', '-w', ...limits, revision, '--', path]))
}

/** Lines added per author under a path in the commits since a date, up to a revision (merges skipped). */
export async function addedLinesByAuthor(cwd: string, revision: string, path: string, since: string): Promise<Map<Identity, number>> {
  return parseNumstatAuthors(await runGit(cwd, ['-c', 'log.mailmap=true', 'log', '--no-merges', '--numstat', '--format=@%aN%x09%aE', `--since=${since}`, revision, '--', path]))
}

/** Author identities of the commits of a revision range (`base..head`), or since a date up to a revision. */
export async function authorIdentities(cwd: string, revision: string, since?: string): Promise<Set<Identity>> {
  const out = await runGit(cwd, ['-c', 'log.mailmap=true', 'log', '--no-merges', '--format=%aN%x09%aE', ...(since === undefined ? [] : [`--since=${since}`]), revision])
  return new Set(out.split('\n').map((l) => l.trim()).filter((l) => l !== ''))
}
