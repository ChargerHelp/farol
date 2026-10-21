import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { UsageError } from '../config/load.js'
import { OutputSchema } from '../output/schema.js'
import { writeTextFile } from '../output/write.js'
import { mergeScore } from '../report/merge-score.js'
import { computeVerdict } from '../report/verdict.js'
import { calibrate, labelCommits, type CalibrationPoint, type CalibrationReport, type HistoryCommit } from '../review/calibration.js'
import type { HistorySummary } from './history.js'

export interface CalibrateOptions {
  /** Directories written by `farol history` (one per repository). */
  history: string[]
  window?: number
  out?: string
}

const CODE_ROLES = new Set(['source', 'resolvers', 'schema', 'routes', 'barrel', 'i18n', 'global'])

/** Points of one history directory: every analyzed commit with its score, verdict and defect label. */
export function historyPoints(dir: string, windowDays: number): { points: CalibrationPoint[]; reasons: Map<string, string> } {
  const summaryPath = join(dir, 'summary.json')
  if (!existsSync(summaryPath)) throw new UsageError(`${summaryPath} not found: run "farol history --out ${dir}" first`)
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as HistorySummary
  const outputs = summary.merges.flatMap((m) => {
    const parsed = OutputSchema.safeParse(JSON.parse(readFileSync(join(dir, m.file), 'utf8')))
    return parsed.success && m.error === null ? [{ m, o: parsed.data }] : []
  })
  const commits: HistoryCommit[] = outputs.map(({ m, o }) => ({ sha: m.sha, date: m.date, subject: m.subject, files: o.files.filter((f) => CODE_ROLES.has(f.role)).map((f) => f.path) }))
  const labels = labelCommits(commits, windowDays)
  const reasons = new Map<string, string>()
  const points = outputs.map(({ m, o }): CalibrationPoint => {
    const label = labels.get(m.sha)
    if (label?.reason) reasons.set(m.sha, label.reason)
    return { sha: m.sha, score: mergeScore(o).score, verdict: computeVerdict(o).level, classification: o.classification, bad: label?.bad === true }
  })
  return { points, reasons }
}

function table(name: string, r: CalibrationReport): string {
  const pct = (x: number): string => `${Math.round(x * 100)}%`
  const lines = [
    `${name}: ${r.total} commits, ${r.bad} followed by a revert or a fix of the same files (${pct(r.baseRate)}); AUC ${r.auc ?? '—'}`,
    `  by verdict: ${(['pass', 'quick', 'careful'] as const).map((v) => `${v} ${r.byVerdict[v].bad}/${r.byVerdict[v].n} (${pct(r.byVerdict[v].rate)})`).join(' · ')}`,
    `  by score:   ${r.byScore.map((b) => `${b.range} ${b.bad}/${b.n}`).join(' · ')}`,
    `  suggested thresholds: quick from ${r.suggested.quick ?? '—'}, careful from ${r.suggested.careful ?? '—'}`,
  ]
  return lines.join('\n')
}

/** Calibration of the merge risk score and the verdict against what happened after each commit. */
export function calibrateCommand(options: CalibrateOptions): Promise<number> {
  const window = options.window ?? 14
  const perRepo = options.history.map((dir) => ({ dir: resolve(dir), ...historyPoints(resolve(dir), window) }))
  const all = calibrate(perRepo.flatMap((r) => r.points))
  const report = { windowDays: window, combined: all, repositories: perRepo.map((r) => ({ dir: r.dir, report: calibrate(r.points), bad: [...r.reasons].map(([sha, reason]) => ({ sha, reason })) })) }
  for (const r of report.repositories) process.stdout.write(`${table(r.dir, r.report)}\n`)
  if (perRepo.length > 1) process.stdout.write(`${table('all repositories', all)}\n`)
  if (options.out !== undefined) writeTextFile(resolve(options.out), `${JSON.stringify(report, null, 2)}\n`)
  return Promise.resolve(0)
}
