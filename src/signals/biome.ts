import { z } from 'zod'
import { parseJson, ReportError } from './coverage.js'
import type { LintMessage } from './lint.js'
import { firstPathFromOtherFolder, type ReportHead, reportPathToRepo } from './paths.js'

// GitLab Code Quality levels, as Biome writes them: Fatal → blocker, Error → critical, Warning → major,
// Information → minor, Hint → info.
const SEVERITY = {
  blocker: 'error',
  critical: 'error',
  major: 'warning',
  minor: 'warning',
  info: 'warning',
} as const satisfies Record<string, LintMessage['severity']>

const Biome = z.array(
  z
    .object({
      check_name: z.string(),
      description: z.string(),
      severity: z.enum(Object.keys(SEVERITY) as [keyof typeof SEVERITY, ...(keyof typeof SEVERITY)[]]),
      location: z.object({ path: z.string(), lines: z.object({ begin: z.number().int().positive() }).loose() }).loose(),
    })
    .loose(),
)

/** Whether a lint report is `biome lint --reporter=gitlab` output (GitLab Code Quality JSON). */
export function isBiomeReport(text: string): boolean {
  return text.trimStart().startsWith('[') && text.includes('"check_name"') && text.includes('"fingerprint"')
}

/**
 * Biome findings as lint messages. Paths are relative to the folder Biome ran in, which must be the project directory.
 * Throws when a path names no file from the project directory but names a changed file of the project from another
 * folder (Biome ran in another folder, such as the repository root).
 */
export function parseBiomeReport(text: string, repoRoot: string, projectPrefix: string, head: ReportHead, canonical?: (path: string) => string): LintMessage[] {
  const parsed = Biome.safeParse(parseJson(text, 'Biome'))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue === undefined || issue.path.length === 0 ? '(root)' : issue.path.join('.')
    throw new ReportError(`the lint report is not Biome GitLab output (biome lint --reporter=gitlab): ${where}: ${issue?.message ?? ''}`)
  }
  const wrong = firstPathFromOtherFolder(parsed.data.map((f) => f.location.path), repoRoot, projectPrefix, head, canonical)
  if (wrong !== undefined) throw new ReportError(`the Biome report path ${wrong} is not relative to the project directory: run biome in ${projectPrefix === '' ? 'the repository root' : projectPrefix}`)
  return parsed.data.map((f) => ({
    path: reportPathToRepo(f.location.path, repoRoot, projectPrefix, canonical) ?? f.location.path.replaceAll('\\', '/'),
    line: f.location.lines.begin,
    rule: f.check_name,
    severity: SEVERITY[f.severity],
    message: f.description,
  }))
}
