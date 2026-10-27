import { isAbsolute, posix } from 'node:path'
import { z } from 'zod'
import { ReportError } from './coverage.js'
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

/**
 * Biome findings as lint messages. Paths are relative to the folder Biome ran in, which must be the project directory:
 * a path that names a changed file (`changed`, repo-relative) only when read from the repository root throws.
 */
export function parseBiomeReport(text: string, repoRoot: string, projectPrefix: string, changed: ReadonlySet<string>, canonical?: (path: string) => string): LintMessage[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new ReportError(`the Biome report is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const parsed = Biome.safeParse(json)
  if (!parsed.success) throw new ReportError('the lint report is not Biome GitLab output (biome lint --reporter=gitlab)')
  const fromRoot = (raw: string): boolean => {
    if (projectPrefix === '' || isAbsolute(raw)) return false
    const path = posix.normalize(raw.replaceAll('\\', '/'))
    return changed.has(path) && !changed.has(posix.join(projectPrefix, path))
  }
  if (parsed.data.some((f) => fromRoot(f.location.path))) throw new ReportError('the Biome report paths start at the repository root: run biome from the project directory')
  return parsed.data.map((f) => ({
    path: reportPathToRepo(f.location.path, repoRoot, projectPrefix, canonical) ?? f.location.path.replaceAll('\\', '/'),
    line: f.location.lines.begin,
    rule: f.check_name,
    severity: SEVERITY[f.severity],
    message: f.description,
  }))
}
