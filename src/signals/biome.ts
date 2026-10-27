import { z } from 'zod'
import { parseJson, ReportError } from './coverage.js'
import type { LintMessage } from './lint.js'
import { reportPathToRepo } from './paths.js'

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

/** The head commit as the reader needs it: the changed files (repo-relative) and whether a path is a file. */
export interface BiomeHead {
  changed: readonly string[]
  exists: (path: string) => boolean
}

/**
 * Biome findings as lint messages. Paths are relative to the folder Biome ran in, which must be the project directory.
 * Throws when a path names no file from the project directory but names a changed file of the project from another
 * folder (Biome ran from the repository root or a parent folder).
 */
export function parseBiomeReport(text: string, repoRoot: string, projectPrefix: string, head: BiomeHead, canonical?: (path: string) => string): LintMessage[] {
  const parsed = Biome.safeParse(parseJson(text, 'Biome'))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ReportError(`the lint report is not Biome GitLab output (biome lint --reporter=gitlab): ${issue?.path.join('.')}: ${issue?.message}`)
  }
  const inProject = (path: string): boolean => projectPrefix === '' || path.startsWith(`${projectPrefix}/`)
  const otherFolder = (raw: string): boolean => {
    const asWritten = reportPathToRepo(raw, repoRoot, '', canonical)
    const mapped = reportPathToRepo(raw, repoRoot, projectPrefix, canonical)
    if (asWritten === undefined || mapped === undefined) return false
    return head.changed.some((c) => c !== mapped && inProject(c) && (c === asWritten || c.endsWith(`/${asWritten}`))) && !head.exists(mapped)
  }
  const wrong = parsed.data.find((f) => otherFolder(f.location.path))
  if (wrong) throw new ReportError(`the Biome report path ${wrong.location.path} is not relative to the project directory: run biome from the project directory`)
  return parsed.data.map((f) => ({
    path: reportPathToRepo(f.location.path, repoRoot, projectPrefix, canonical) ?? f.location.path.replaceAll('\\', '/'),
    line: f.location.lines.begin,
    rule: f.check_name,
    severity: SEVERITY[f.severity],
    message: f.description,
  }))
}
