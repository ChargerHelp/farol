import { loadContext } from '../../src/cli/context.js'
import { runAnalyze, type AnalyzeOptions } from '../../src/cli/analyze.js'
import type { Output } from '../../src/output/schema.js'
import { OutputSchema } from '../../src/output/schema.js'
import { createScenarioRepo, type TestRepo } from './repo.js'

export const FIXED_DATE = new Date('2026-01-15T12:00:00.000Z')

/** Runs analyze in-process with a fixed clock; the output is validated by the schema. */
export async function analyzeRepo(repo: TestRepo, options: Partial<AnalyzeOptions> = {}): Promise<{ output: Output; failed: boolean }> {
  const ctx = await loadContext({ config: 'farol.config.json', cwd: repo.dir, verbose: false })
  const result = await runAnalyze(ctx, { base: 'main', head: 'feature', ...options }, { now: () => FIXED_DATE, clock: () => 0, env: {} })
  OutputSchema.parse(result.output)
  return result
}

export async function analyzeScenario(scenario: string, options: Partial<AnalyzeOptions> = {}): Promise<{ output: Output; failed: boolean; repo: TestRepo; cleanup: () => void }> {
  const { repo } = createScenarioRepo(scenario)
  const result = await analyzeRepo(repo, options)
  return { ...result, repo, cleanup: () => { repo.cleanup(); } }
}

/** Replaces commit SHAs with placeholders so golden files survive fixture edits that do not change the result. */
export function normalizeOutput(output: Output): Output {
  // Inline diffs repeat the fixtures' text: golden files keep the analysis only (diffs have their own tests).
  const rest: Partial<Output> = { ...output }
  delete rest.diffs
  const json = JSON.stringify(rest)
  const shas = new Map<string, string>()
  if (output.base.sha) shas.set(output.base.sha, '<base>')
  if (output.mergeBase) shas.set(output.mergeBase, output.mergeBase === output.base.sha ? '<base>' : '<merge-base>')
  if (output.head.sha) shas.set(output.head.sha, '<head>')
  let text = json
  for (const [sha, placeholder] of shas) text = text.replaceAll(sha, placeholder)
  return JSON.parse(text) as Output
}
