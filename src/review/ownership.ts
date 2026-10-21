import { z } from 'zod'
import { compareStrings } from '../output/order.js'

const share = z.number().min(0).max(100)

/** reviewers.json, written by `farol reviewers` and read by html/report/comment (--reviewers). */
export const ReviewersFileSchema = z
  .object({
    farolReviewers: z.literal(1),
    head: z.string().nullable(),
    /** Authors of the PR's own commits: never suggested. */
    prAuthors: z.array(z.string()),
    /** CODEOWNERS owners of the changed files. */
    codeowners: z.array(z.object({ name: z.string(), files: z.array(z.string()) }).strict()),
    /**
     * People who wrote the code the PR changes, best first. `score`: share (0–100) of the PR's risk, weighed by file,
     * whose code they wrote; `active`: committed in the last 6 months.
     */
    reviewers: z.array(z.object({ name: z.string(), score: share, active: z.boolean(), files: z.array(z.object({ path: z.string(), share }).strict()) }).strict()),
    /** The main author of each changed code file (PR authors and bots left out). */
    files: z.array(z.object({ path: z.string(), owner: z.string(), share }).strict()),
  })
  .strict()

export type ReviewersFile = z.infer<typeof ReviewersFileSchema>

const BOT = /\[bot\]$|^dependabot|^renovate|^github-actions/i

/** Old-side line ranges of a file's diff hunks: removed lines and the context around the changes. */
export function touchedRanges(hunks: readonly { oldStart: number; lines: readonly string[] }[]): [number, number][] {
  const lines: number[] = []
  for (const h of hunks) {
    let old = h.oldStart
    for (const l of h.lines) {
      if (l.startsWith('+')) continue
      if (l.startsWith('-') || l.startsWith(' ')) {
        if (old > 0) lines.push(old)
        old++
      }
    }
  }
  const ranges: [number, number][] = []
  for (const n of [...new Set(lines)].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else ranges.push([n, n])
  }
  return ranges
}

export interface FileAuthorship {
  path: string
  /** How much the file matters in the review (its risk points); at least a small positive weight. */
  weight: number
  /** Lines per author: the whole file at the base (or, for a new file, lines added to its directory recently). */
  whole: ReadonlyMap<string, number>
  /** Lines per author of the code the PR changes and its context, at the base; null for new files. */
  touched: ReadonlyMap<string, number> | null
}

function shares(lines: ReadonlyMap<string, number>, skip: (name: string) => boolean): Map<string, number> {
  const kept = [...lines].filter(([name]) => !skip(name))
  const total = kept.reduce((n, [, v]) => n + v, 0)
  return new Map(total === 0 ? [] : kept.map(([name, v]) => [name, v / total]))
}

/**
 * Reviewers by authorship: each person's share of each file (half the whole file, half the changed lines and their
 * context when there are any), weighed by the file's risk. Inactive people rank lower (a quarter of their score) but
 * are still listed, labeled.
 */
export function rankOwners(files: readonly FileAuthorship[], prAuthors: ReadonlySet<string>, active: ReadonlySet<string>, max = 5): Pick<ReviewersFile, 'reviewers' | 'files'> {
  const skip = (name: string): boolean => prAuthors.has(name) || BOT.test(name)
  const totalWeight = files.reduce((n, f) => n + f.weight, 0)
  const people = new Map<string, { score: number; files: { path: string; share: number; weighted: number }[] }>()
  const owners: ReviewersFile['files'] = []
  for (const f of files) {
    const whole = shares(f.whole, skip)
    const touched = f.touched === null ? new Map<string, number>() : shares(f.touched, skip)
    const names = new Set([...whole.keys(), ...touched.keys()])
    const per = new Map([...names].map((n) => [n, touched.size === 0 ? (whole.get(n) ?? 0) : 0.5 * (whole.get(n) ?? 0) + 0.5 * (touched.get(n) ?? 0)]))
    for (const [name, s] of per) {
      if (s <= 0) continue
      const p = people.get(name) ?? { score: 0, files: [] }
      p.score += (f.weight * s) / (totalWeight || 1)
      p.files.push({ path: f.path, share: Math.round(s * 100), weighted: f.weight * s })
      people.set(name, p)
    }
    const top = [...per].sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]))[0]
    if (top && top[1] > 0) owners.push({ path: f.path, owner: top[0], share: Math.round(top[1] * 100) })
  }
  const ranked = [...people]
    .map(([name, p]) => ({ name, score: Math.round(p.score * 100), active: active.has(name), rank: p.score * (active.has(name) ? 1 : 0.25), files: p.files.sort((a, b) => b.weighted - a.weighted || compareStrings(a.path, b.path)).slice(0, 3).map(({ path, share: s }) => ({ path, share: s })) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.rank - a.rank || compareStrings(a.name, b.name))
    .slice(0, max)
    .map((r) => ({ name: r.name, score: r.score, active: r.active, files: r.files }))
  return { reviewers: ranked, files: owners.sort((a, b) => compareStrings(a.path, b.path)) }
}
