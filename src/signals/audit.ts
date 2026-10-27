import { z } from 'zod'
import { compareStrings } from '../output/order.js'
import type { VulnerabilitiesSignal } from '../output/schema.js'
import { parseJson, ReportError } from './coverage.js'

export const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

/** One advisory affecting one installed package, normalized from npm or pnpm audit output. */
export interface Advisory {
  package: string
  severity: Severity
  title: string
  id: string
  url: string | null
  cves: string[]
  vulnerableRange: string | null
  patchedVersions: string | null
  /** Dependency paths from the project to the vulnerable package (package names). */
  paths: string[][]
}

/** npm audit --json (npm 7+, auditReportVersion 2). */
const NpmV2 = z
  .object({
    auditReportVersion: z.literal(2),
    vulnerabilities: z.record(
      z.string(),
      z
        .object({
          name: z.string(),
          severity: z.enum(SEVERITIES),
          via: z.array(z.union([z.string(), z.object({ name: z.string(), title: z.string(), url: z.string().optional(), severity: z.enum(SEVERITIES), range: z.string().optional() }).loose()])),
        })
        .loose(),
    ),
  })
  .loose()

/** pnpm audit --json and npm 6 (advisories keyed by id). */
const Advisories = z
  .object({
    advisories: z.record(
      z.string(),
      z
        .object({
          module_name: z.string(),
          severity: z.enum(SEVERITIES),
          title: z.string(),
          url: z.string().optional(),
          cves: z.array(z.string()).optional(),
          github_advisory_id: z.string().optional(),
          vulnerable_versions: z.string().optional(),
          patched_versions: z.string().optional(),
          findings: z.array(z.object({ paths: z.array(z.string()).optional() }).loose()).optional(),
        })
        .loose(),
    ),
  })
  .loose()

function idFromUrl(url: string | undefined): string | null {
  if (url === undefined) return null
  const last = url.split('/').pop() ?? ''
  return last.startsWith('GHSA-') ? last : null
}

/** Parses npm (7+) or pnpm audit JSON into advisories. Throws ReportError for anything else. */
export function parseAuditReport(text: string): { advisories: Advisory[]; dependsOn: Map<string, string[]> } {
  const raw = parseJson(text, 'audit')
  const npm = NpmV2.safeParse(raw)
  if (npm.success) {
    const advisories: Advisory[] = []
    // npm lists, per vulnerable package, the advisories on it and the vulnerable packages it depends on.
    const dependsOn = new Map<string, string[]>()
    for (const entry of Object.values(npm.data.vulnerabilities)) {
      dependsOn.set(entry.name, entry.via.filter((v): v is string => typeof v === 'string'))
      for (const via of entry.via) {
        if (typeof via === 'string' || via.name !== entry.name) continue
        advisories.push({ package: via.name, severity: via.severity, title: via.title, id: idFromUrl(via.url) ?? via.title, url: via.url ?? null, cves: [], vulnerableRange: via.range ?? null, patchedVersions: null, paths: [] })
      }
    }
    return { advisories, dependsOn }
  }
  const pnpm = Advisories.safeParse(raw)
  if (pnpm.success) {
    const advisories = Object.entries(pnpm.data.advisories).map(([key, a]): Advisory => ({
      package: a.module_name,
      severity: a.severity,
      title: a.title,
      id: a.github_advisory_id ?? idFromUrl(a.url) ?? a.cves?.[0] ?? key,
      url: a.url ?? null,
      cves: a.cves ?? [],
      vulnerableRange: a.vulnerable_versions ?? null,
      patchedVersions: a.patched_versions ?? null,
      paths: (a.findings ?? []).flatMap((f) => f.paths ?? []).map((p) => p.split('>').map((s) => s.trim())),
    }))
    return { advisories, dependsOn: new Map() }
  }
  throw new ReportError('the audit report is neither "npm audit --json" (npm 7+) nor "pnpm audit --json" output')
}

const RANK = new Map(SEVERITIES.map((s, i) => [s, i]))

/**
 * Advisories reachable from the dependencies this PR added or changed: on the package itself (direct) or on a
 * package it depends on (transitive). The rest of the report only counts as context.
 */
export function vulnerabilitiesSignal(report: { advisories: Advisory[]; dependsOn: Map<string, string[]> }, changedPackages: ReadonlySet<string>): VulnerabilitiesSignal {
  const related = new Map<string, VulnerabilitiesSignal['related'][number]>()
  const add = (a: Advisory, root: string): void => {
    const key = `${a.id}\0${a.package}`
    const current = related.get(key)
    const kind = a.package === root ? 'direct' : 'transitive'
    if (current) {
      if (!current.relatedTo.includes(root)) current.relatedTo = [...current.relatedTo, root].sort(compareStrings)
      if (kind === 'direct') current.kind = 'direct'
      return
    }
    related.set(key, {
      package: a.package,
      severity: a.severity,
      title: a.title,
      id: a.id,
      url: a.url,
      cves: a.cves,
      vulnerableRange: a.vulnerableRange,
      patchedVersions: a.patchedVersions,
      relatedTo: [root],
      kind,
    })
  }
  for (const root of changedPackages) {
    // npm: walk "depends on a vulnerable package" links from the changed dependency.
    const seen = new Set<string>()
    const stack = [root]
    while (stack.length > 0) {
      const name = stack.pop() ?? ''
      if (seen.has(name)) continue
      seen.add(name)
      for (const a of report.advisories) if (a.package === name) add(a, root)
      stack.push(...(report.dependsOn.get(name) ?? []))
    }
    // pnpm: the advisory lists the dependency paths that lead to it.
    for (const a of report.advisories) if (a.paths.some((p) => p.includes(root))) add(a, root)
  }
  const total = Object.fromEntries(SEVERITIES.map((s) => [s, report.advisories.filter((a) => a.severity === s).length])) as Record<Severity, number>
  const list = [...related.values()].sort((a, b) => (RANK.get(a.severity) ?? 9) - (RANK.get(b.severity) ?? 9) || compareStrings(a.package, b.package) || compareStrings(a.id, b.id))
  return { status: 'ok', related: list, total }
}
