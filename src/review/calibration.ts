import { compareStrings } from '../output/order.js'

/** One analyzed commit of a branch (a merged PR, or a first-parent commit). */
export interface HistoryCommit {
  sha: string
  /** ISO date of the commit. */
  date: string
  subject: string
  /** Changed code files (tests and docs left out by the caller). */
  files: string[]
}

export interface Label {
  bad: boolean
  /** Why: the revert or the fix that followed, with its short SHA. */
  reason: string | null
}

const REVERT = /^revert\b/i
// Conventional-commit fixes and plain "fix", "hotfix", "bugfix" subjects.
const FIX = /^(fix|hotfix|bugfix)(\([^)]*\))?!?:|\b(hot ?fix|bug ?fix|fix(es|ed)?)\b/i

/**
 * Commits that likely introduced a defect (an SZZ-like proxy): reverted by a later commit, or followed within
 * `windowDays` by a fix that changes at least one of the same code files. Commits are in any order.
 */
export function labelCommits(commits: readonly HistoryCommit[], windowDays = 14): Map<string, Label> {
  const sorted = [...commits].sort((a, b) => compareStrings(a.date, b.date) || compareStrings(a.sha, b.sha))
  const labels = new Map<string, Label>(sorted.map((c) => [c.sha, { bad: false, reason: null }]))
  const windowMs = windowDays * 24 * 3600 * 1000
  sorted.forEach((c, i) => {
    const t = Date.parse(c.date)
    for (const later of sorted.slice(i + 1)) {
      if (Date.parse(later.date) - t > windowMs) break
      const reverts = REVERT.test(later.subject) && (later.subject.includes(c.subject.slice(0, 40)) || later.subject.includes(c.sha.slice(0, 7)))
      const fixes = FIX.test(later.subject) && later.files.some((f) => c.files.includes(f))
      if (reverts || fixes) {
        labels.set(c.sha, { bad: true, reason: `${reverts ? 'reverted' : 'fixed'} by ${later.sha.slice(0, 7)} ${later.subject.slice(0, 80)}` })
        break
      }
    }
  })
  return labels
}

export interface CalibrationPoint {
  sha: string
  score: number
  verdict: 'pass' | 'quick' | 'careful'
  classification: string
  bad: boolean
}

export interface CalibrationReport {
  total: number
  bad: number
  baseRate: number
  byVerdict: Record<'pass' | 'quick' | 'careful', { n: number; bad: number; rate: number }>
  byScore: { range: string; n: number; bad: number; rate: number }[]
  byClass: Record<string, { n: number; bad: number; rate: number }>
  /** Probability that a bad commit scores above a good one (0.5 = no signal, 1 = perfect ranking). */
  auc: number | null
  /**
   * Score thresholds the data supports: below `quick` the bad rate is at most half the base rate; from `careful` on
   * it is at least 1.5 times the base rate. Null when no threshold qualifies.
   */
  suggested: { quick: number | null; careful: number | null }
}

const rate = (bad: number, n: number): number => (n === 0 ? 0 : Math.round((bad / n) * 1000) / 1000)

export function calibrate(points: readonly CalibrationPoint[]): CalibrationReport {
  const bad = points.filter((p) => p.bad).length
  const baseRate = rate(bad, points.length)
  const group = <K extends string>(keyOf: (p: CalibrationPoint) => K): Partial<Record<K, { n: number; bad: number; rate: number }>> => {
    const out: Partial<Record<K, { n: number; bad: number; rate: number }>> = {}
    for (const p of points) {
      const k = keyOf(p)
      const g = out[k] ?? { n: 0, bad: 0, rate: 0 }
      g.n++
      if (p.bad) g.bad++
      g.rate = rate(g.bad, g.n)
      out[k] = g
    }
    return out
  }
  const verdicts = group((p) => p.verdict)
  const empty = { n: 0, bad: 0, rate: 0 }
  const byVerdict = { pass: verdicts.pass ?? empty, quick: verdicts.quick ?? empty, careful: verdicts.careful ?? empty }
  const byScore = [0, 20, 40, 60, 80].map((lo) => {
    const inRange = points.filter((p) => p.score >= lo && (lo === 80 ? p.score <= 100 : p.score < lo + 20))
    const b = inRange.filter((p) => p.bad).length
    return { range: `${lo}–${lo === 80 ? 100 : lo + 19}`, n: inRange.length, bad: b, rate: rate(b, inRange.length) }
  })
  const goods = points.filter((p) => !p.bad)
  const bads = points.filter((p) => p.bad)
  let auc: number | null = null
  if (goods.length > 0 && bads.length > 0) {
    let wins = 0
    for (const b of bads) for (const g of goods) wins += b.score > g.score ? 1 : b.score === g.score ? 0.5 : 0
    auc = Math.round((wins / (bads.length * goods.length)) * 1000) / 1000
  }
  const scores = [...new Set(points.map((p) => p.score))].sort((a, b) => a - b)
  let quick: number | null = null
  let careful: number | null = null
  for (const s of scores) {
    const below = points.filter((p) => p.score < s)
    if (below.length >= 5 && rate(below.filter((p) => p.bad).length, below.length) <= baseRate / 2) quick = s
  }
  for (const s of [...scores].reverse()) {
    const above = points.filter((p) => p.score >= s)
    if (above.length >= 5 && rate(above.filter((p) => p.bad).length, above.length) >= baseRate * 1.5) careful = s
  }
  const byClass = Object.fromEntries(Object.entries(group((p) => p.classification)).flatMap(([k, v]) => (v ? [[k, v]] : []))) as Record<string, { n: number; bad: number; rate: number }>
  return { total: points.length, bad, baseRate, byVerdict, byScore, byClass, auc, suggested: { quick, careful } }
}
