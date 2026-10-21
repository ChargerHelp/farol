import { join, resolve } from 'node:path'
import { CLASSIFICATIONS, type Classification } from '../classify/reasons.js'
import { listMerges } from '../git/index.js'
import { serializeOutput, writeTextFile } from '../output/write.js'
import { runAnalyze, realDeps, type AnalyzeDeps } from './analyze.js'
import type { Context } from './context.js'

export interface HistoryOptions {
  since: string
  branch: string
  out: string
  firstParent?: boolean
  ignore?: string[]
}

export interface HistorySummary {
  branch: string
  since: string
  mode: 'merges' | 'first-parent'
  total: number
  failed: number
  byClass: Record<Classification, number>
  merges: { sha: string; firstParent: string; date: string; subject: string; classification: Classification; file: string; error: string | null }[]
}

/** Analyzes every merge commit (or every first-parent commit) of a branch against its first parent. */
export async function runHistory(ctx: Context, options: HistoryOptions, deps: AnalyzeDeps, progress: (line: string) => void): Promise<HistorySummary> {
  const mode = options.firstParent === true ? 'first-parent' : 'merges'
  const merges = await listMerges(ctx.repoRoot, options.branch, options.since, mode === 'first-parent')
  const outDir = resolve(options.out)
  const byClass = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>
  const summary: HistorySummary = { branch: options.branch, since: options.since, mode, total: merges.length, failed: 0, byClass, merges: [] }
  for (const [i, merge] of merges.entries()) {
    // Reports of the working tree say nothing about old commits: history only computes diff-based signals.
    const { output, failed } = await runAnalyze(ctx, { base: merge.firstParent, head: merge.sha, ...(options.ignore ? { ignore: options.ignore } : {}) }, deps)
    const file = `${merge.sha}.json`
    writeTextFile(join(outDir, file), serializeOutput(output))
    byClass[output.classification]++
    if (failed) summary.failed++
    summary.merges.push({ sha: merge.sha, firstParent: merge.firstParent, date: merge.date, subject: merge.subject, classification: output.classification, file, error: output.diagnostics.error })
    progress(`[${i + 1}/${merges.length}] ${merge.sha.slice(0, 12)} ${output.classification}${failed ? ' (analysis failed)' : ''} ${merge.subject.slice(0, 80)}`)
  }
  writeTextFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

export async function historyCommand(ctx: Context, options: HistoryOptions): Promise<number> {
  const summary = await runHistory(ctx, options, realDeps(), (line) => process.stderr.write(`farol: ${line}\n`))
  const counts = CLASSIFICATIONS.map((c) => `${c}: ${summary.byClass[c]}`).join(', ')
  process.stderr.write(`farol: ${summary.total} ${summary.mode === 'merges' ? 'merge commit(s)' : 'commit(s)'} analyzed (${counts}); results in ${resolve(options.out)}\n`)
  return 0
}
