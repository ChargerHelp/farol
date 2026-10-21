import { posix } from 'node:path'
import type { AnalysisRole } from '../classify/roles.js'
import { logAuthors, readFiles } from '../git/index.js'
import type { ChangedFile } from '../git/types.js'
import { parseCodeowners, rankReviewers, type Reviewer } from '../review/reviewers.js'
import type { Context } from './context.js'

const CODEOWNERS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']
/** History read per file: the last commits of the past year, for at most this many changed files. */
const MAX_FILES = 80
const MAX_COMMITS = 30
const CODE_ROLES = new Set(['source', 'resolvers', 'schema', 'routes', 'barrel', 'i18n', 'global'])

/** Reviewers for a PR from the head's CODEOWNERS and the git history (before the PR) of the changed code files. */
export async function suggestReviewers(ctx: Context, files: readonly ChangedFile[], roleOf: (path: string) => AnalysisRole | 'outside', mergeBaseSha: string, headSha: string): Promise<Reviewer[]> {
  const code = files.filter((f) => CODE_ROLES.has(roleOf(f.path)))
  const owners = await readFiles(ctx.repoRoot, headSha, CODEOWNERS)
  const rules = parseCodeowners(CODEOWNERS.map((p) => owners.get(p)).find((t) => t !== undefined) ?? '')
  const prAuthors = new Set(await logAuthors(ctx.repoRoot, `${mergeBaseSha}..${headSha}`))
  const history = new Map<string, string[]>()
  for (const f of code.filter((x) => x.status !== 'added').slice(0, MAX_FILES)) {
    history.set(f.path, await logAuthors(ctx.repoRoot, mergeBaseSha, { path: f.oldPath ?? f.path, max: MAX_COMMITS, since: '12 months ago' }))
  }
  // New files have no history: the authors of their directory stand in.
  for (const f of code.filter((x) => x.status === 'added').slice(0, MAX_FILES)) {
    const dir = posix.dirname(f.path)
    if (dir !== '.') history.set(f.path, await logAuthors(ctx.repoRoot, mergeBaseSha, { path: dir, max: MAX_COMMITS, since: '12 months ago' }))
  }
  return rankReviewers(code.map((f) => f.path), rules, history, prAuthors)
}
