import { z } from 'zod'
import type { ChangedFile } from '../git/types.js'
import { compareStrings } from '../output/order.js'
import type { LintFinding, LintSignal } from '../output/schema.js'
import { ReportError } from './coverage.js'
import { reportPathToRepo } from './paths.js'

const MAX_FINDINGS = 50

const EslintReport = z.array(
  z
    .object({
      filePath: z.string(),
      messages: z.array(z.object({ ruleId: z.string().nullable().optional(), severity: z.number(), message: z.string(), line: z.number().int().optional() }).loose()),
    })
    .loose(),
)

export interface LintMessage {
  path: string
  line: number | undefined
  rule: string
  severity: 'error' | 'warning'
  message: string
}

/** Parses `eslint -f json` output; messages with severity 0 (off) are dropped. */
export function parseEslintReport(text: string, repoRoot: string, projectPrefix: string, canonical?: (path: string) => string): LintMessage[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ReportError(`the ESLint report is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const parsed = EslintReport.safeParse(raw)
  if (!parsed.success) throw new ReportError('the ESLint report is not in the "eslint -f json" format')
  const messages: LintMessage[] = []
  for (const entry of parsed.data) {
    const path = reportPathToRepo(entry.filePath, repoRoot, projectPrefix, canonical) ?? entry.filePath.replaceAll('\\', '/')
    for (const m of entry.messages) {
      if (m.severity !== 1 && m.severity !== 2) continue
      messages.push({ path, line: m.line, rule: m.ruleId ?? '(fatal)', severity: m.severity === 2 ? 'error' : 'warning', message: m.message })
    }
  }
  return messages
}

/** Lint findings on changed lines (they count) versus other lines of the reported files (context only). */
export function lintSignal(messages: readonly LintMessage[], files: readonly ChangedFile[]): LintSignal {
  const changedLines = new Map<string, Set<number>>()
  for (const f of files) if (f.status !== 'deleted') changedLines.set(f.path, new Set(f.added.map((l) => l.line)))
  const onChanged: LintFinding[] = []
  const other = { errors: 0, warnings: 0 }
  for (const m of messages) {
    if (m.line !== undefined && changedLines.get(m.path)?.has(m.line)) onChanged.push({ path: m.path, line: m.line, rule: m.rule, severity: m.severity, message: m.message })
    else if (m.severity === 'error') other.errors++
    else other.warnings++
  }
  onChanged.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || compareStrings(a.path, b.path) || a.line - b.line || compareStrings(a.rule, b.rule))
  const errors = onChanged.filter((f) => f.severity === 'error').length
  return {
    status: 'ok',
    changedLines: { errors, warnings: onChanged.length - errors },
    otherLines: other,
    findings: onChanged.slice(0, MAX_FINDINGS),
    omittedFindings: Math.max(0, onChanged.length - MAX_FINDINGS),
  }
}
