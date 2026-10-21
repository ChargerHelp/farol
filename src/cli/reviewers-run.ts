import { posix, resolve } from 'node:path'
import { UsageError } from '../config/load.js'
import { addedLinesByAuthor, authorIdentities, blameAuthors } from '../git/authors.js'
import { readFiles } from '../git/index.js'
import { canonicalNames } from '../review/identities.js'
import { compareStrings } from '../output/order.js'
import { writeTextFile } from '../output/write.js'
import { scoreByFile } from '../report/html-score.js'
import { isCode } from '../report/merge-score.js'
import { rankOwners, touchedRanges, type FileAuthorship, type ReviewersFile } from '../review/ownership.js'
import { ownersOf, parseCodeowners } from '../review/reviewers.js'
import type { Context } from './context.js'
import { mapLimit } from './concurrency.js'
import { readOutputFile } from './report.js'
import { EXIT_OK, writeStdout } from './run.js'

export interface ReviewersOptions {
  in: string
  out?: string
}

const CODEOWNERS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']
/** Files blamed: the riskiest changed code files first, at most this many. */
const MAX_FILES = 40
/** git processes run at once. */
const BLAME_CONCURRENCY = 8
const CODE_ROLES = new Set(['source', 'resolvers', 'schema', 'routes', 'barrel', 'i18n', 'global'])

/**
 * Reviewers for an analyzed PR by who wrote the code it changes (git blame at the merge-base, weighed by each file's
 * risk), plus CODEOWNERS. Reads git only; written to a file html/report/comment can add (--reviewers).
 */
export async function runReviewers(ctx: Context, options: ReviewersOptions): Promise<ReviewersFile> {
  const o = readOutputFile(options.in)
  const base = o.mergeBase
  const head = o.head.sha
  if (base === null || head === null) throw new UsageError(`${resolve(options.in)} has no merge-base or head commit (the analysis failed): run "farol analyze" again`)
  const points = scoreByFile(o)
  const code = o.files
    .filter((f) => CODE_ROLES.has(f.role) && isCode(f.path))
    .sort((a, b) => (points.get(b.path) ?? 0) - (points.get(a.path) ?? 0) || compareStrings(a.path, b.path))
    .slice(0, MAX_FILES)
  // git blame of each file, several at a time (each call is a separate git process).
  const files: FileAuthorship[] = await mapLimit(code, BLAME_CONCURRENCY, async (f) => {
    const weight = Math.max(1, points.get(f.path) ?? 0)
    if (f.status === 'added') {
      // New code has no blame: the people who wrote its directory recently stand in.
      const dir = posix.dirname(f.path)
      return { path: f.path, weight, whole: dir === '.' ? new Map<string, number>() : await addedLinesByAuthor(ctx.repoRoot, base, dir, '12 months ago'), touched: null }
    }
    const basePath = f.oldPath ?? f.path
    const ranges = touchedRanges(o.diffs?.find((d) => d.path === f.path)?.hunks ?? [])
    const [whole, touched] = await Promise.all([blameAuthors(ctx.repoRoot, base, basePath), ranges.length === 0 ? null : blameAuthors(ctx.repoRoot, base, basePath, ranges)])
    return { path: f.path, weight, whole, touched }
  })
  const [prIds, activeIds] = await Promise.all([authorIdentities(ctx.repoRoot, `${base}..${head}`), authorIdentities(ctx.repoRoot, head, '6 months ago')])
  // One person often has several git identities (laptop, GitHub web, login as name): merged before ranking.
  const lines = new Map<string, number>()
  for (const f of files) for (const m of [f.whole, f.touched ?? new Map<string, number>()]) for (const [id, n] of m) lines.set(id, (lines.get(id) ?? 0) + n)
  const canon = canonicalNames([...lines.keys(), ...prIds, ...activeIds], (id) => lines.get(id) ?? 0)
  const rename = (m: ReadonlyMap<string, number>): Map<string, number> => {
    const out = new Map<string, number>()
    for (const [id, n] of m) {
      const name = canon.get(id) ?? id
      out.set(name, (out.get(name) ?? 0) + n)
    }
    return out
  }
  const named = files.map((f) => ({ ...f, whole: rename(f.whole), touched: f.touched === null ? null : rename(f.touched) }))
  const prAuthors = new Set([...prIds].map((id) => canon.get(id) ?? id))
  const active = new Set([...activeIds].map((id) => canon.get(id) ?? id))
  const ranked = rankOwners(named, prAuthors, active)
  const owners = await readFiles(ctx.repoRoot, head, CODEOWNERS)
  const rules = parseCodeowners(CODEOWNERS.map((p) => owners.get(p)).find((t) => t !== undefined) ?? '')
  const byOwner = new Map<string, string[]>()
  for (const f of o.files) for (const owner of ownersOf(rules, f.path)) byOwner.set(owner, [...(byOwner.get(owner) ?? []), f.path])
  ctx.log(`reviewers: blamed ${files.length} file(s), ${ranked.reviewers.length} suggestion(s), ${byOwner.size} code owner(s)`)
  return {
    farolReviewers: 1,
    head,
    prAuthors: [...prAuthors].sort(compareStrings),
    codeowners: [...byOwner].map(([name, list]) => ({ name, files: list.sort(compareStrings) })).sort((a, b) => b.files.length - a.files.length || compareStrings(a.name, b.name)),
    ...ranked,
  }
}

export async function reviewersCommand(ctx: Context, options: ReviewersOptions): Promise<number> {
  const text = `${JSON.stringify(await runReviewers(ctx, options), null, 2)}\n`
  if (options.out === undefined) await writeStdout(text)
  else writeTextFile(resolve(options.out), text)
  return EXIT_OK
}
