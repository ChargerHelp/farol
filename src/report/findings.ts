import { REASONS, type ReasonCode } from '../classify/reasons.js'
import { sortedUnique } from '../output/order.js'
import type { Output, SuppressionKind } from '../output/schema.js'
import { FINDINGS_TEXT as F, terms } from './strings.js'

export type Severity = 'high' | 'medium' | 'low'

/** One thing a reviewer should look at, derived from the analyze JSON. */
export interface Finding {
  severity: Severity
  title: string
  detail?: string
  files: string[]
  /** id of the report section with the details. */
  section: 'overview' | 'risk' | 'security' | 'dependencies' | 'signals' | 'routes' | 'files' | 'details'
}

/** Coverage below this share of changed executable lines is a high-severity finding; below MEDIUM, medium. */
export const COVERAGE_HIGH = 0.5
export const COVERAGE_MEDIUM = 0.8

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** Suppressions that switch checks off for a whole file, a block or a range, or every type error of a line: high. */
const STRONG_SUPPRESSIONS: ReadonlySet<SuppressionKind> = new Set<SuppressionKind>(['ts-nocheck', 'eslint-disable', 'ts-ignore', 'biome-ignore-all', 'biome-ignore-start', 'type-ignore', 'pyright-ignore'])

function filesOf(output: Output, ...codes: ReasonCode[]): string[] {
  return sortedUnique(output.reasons.filter((r) => codes.includes(r.code) && r.file !== undefined).map((r) => r.file ?? ''))
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function dependencyFindings(o: Output, out: Finding[]): void {
  const label = (c: Output['dependencies']['changes'][number]): string =>
    c.change === 'removed' ? `${c.name} removed` : c.change === 'added' ? `${c.name} added` : `${c.name} ${c.from ?? ''} → ${c.to ?? ''}${c.bump ? ` (${c.bump})` : ''}`
  const critical = o.dependencies.changes.filter((c) => c.critical)
  const other = o.dependencies.changes.filter((c) => !c.critical)
  if (critical.length > 0) out.push({ severity: 'high', title: F.criticalDependencies(critical.length), detail: F.criticalDependenciesDetail(critical.slice(0, 8).map(label).join(', ')), files: sortedUnique(critical.map((c) => c.manifest)), section: 'dependencies' })
  const manifests = filesOf(o, 'manifest-changed')
  if (manifests.length > 0) out.push({ severity: 'high', title: F.manifestChanged(manifests.length), detail: o.reasons.filter((r) => r.code === 'manifest-changed').map((r) => r.detail).join('; '), files: manifests, section: 'dependencies' })
  const lockOnly = filesOf(o, 'lockfile-only-change')
  if (lockOnly.length > 0) out.push({ severity: 'high', title: F.lockfileOnly, detail: F.lockfileOnlyDetail, files: lockOnly, section: 'dependencies' })
  const elsewhere = o.reasons.filter((r) => r.code === 'lockfile-changed-elsewhere')
  if (elsewhere.length > 0) out.push({ severity: 'low', title: F.lockfileElsewhere, detail: elsewhere.map((r) => r.detail).join('; '), files: filesOf(o, 'lockfile-changed-elsewhere'), section: 'dependencies' })
  if (other.length > 0) out.push({ severity: 'low', title: F.otherDependencies(other.length), detail: F.otherDependenciesDetail(other.slice(0, 8).map(label).join(', ')), files: sortedUnique(other.map((c) => c.manifest)), section: 'dependencies' })
}

function classificationFindings(o: Output, out: Finding[]): void {
  if (o.diagnostics.error !== null) out.push({ severity: 'high', title: F.analysisError, detail: o.diagnostics.error, files: [], section: 'details' })
  const dynamic = o.reasons.filter((r) => r.code === 'dynamic-route')
  if (dynamic.length > 0) out.push({ severity: 'high', title: F.dynamicRoutes(dynamic.length), detail: F.unknownDetail, files: filesOf(o, 'dynamic-route'), section: 'details' })
  const parse = filesOf(o, 'parse-error')
  if (parse.length > 0) out.push({ severity: 'high', title: F.parseErrors(parse.length), detail: F.unknownDetail, files: parse, section: 'details' })
  const unresolved = o.reasons.filter((r) => r.code === 'unresolved-import')
  if (unresolved.length > 0) out.push({ severity: 'high', title: F.unresolved(unresolved.length), detail: F.unknownDetail, files: filesOf(o, 'unresolved-import'), section: 'details' })
  dependencyFindings(o, out)
  const globals = filesOf(o, 'global-file-changed')
  if (globals.length > 0) out.push({ severity: 'high', title: F.globalFiles(globals.length), detail: F.globalDetail, files: globals, section: 'files' })
  const routeChanges = o.reasons.filter((r) => r.code === 'routes-not-additive' && r.detail.startsWith('route '))
  if (routeChanges.length > 0) out.push({ severity: 'high', title: F.routesChanged(routeChanges.length), detail: routeChanges.map((r) => r.detail).slice(0, 3).join('; '), files: [], section: 'routes' })
}

function securityFindings(o: Output, out: Finding[]): void {
  const v = o.signals.vulnerabilities
  if (v.status !== 'ok') out.push({ severity: 'low', title: F.notVerified(F.auditName), detail: v.message, files: [], section: 'security' })
  const label = (r: typeof v.related[number]): string => `${r.package} (${r.severity}, ${r.id}${r.kind === 'transitive' ? `, via ${r.relatedTo.join('/')}` : ''})`
  const severe = v.related.filter((r) => r.severity === 'critical' || r.severity === 'high')
  const other = v.related.filter((r) => r.severity !== 'critical' && r.severity !== 'high')
  if (severe.length > 0) out.push({ severity: 'high', title: F.vulnCritical(severe.length), detail: F.vulnDetail(severe.slice(0, 6).map(label).join(', ')), files: [], section: 'security' })
  if (other.length > 0) out.push({ severity: 'medium', title: F.vulnOther(other.length), detail: F.vulnDetail(other.slice(0, 6).map(label).join(', ')), files: [], section: 'security' })
  const s = o.signals.security
  for (const level of ['high', 'medium', 'low'] as const) {
    const list = s.findings.filter((f) => f.severity === level)
    if (list.length === 0) continue
    const title = level === 'high' ? F.sastHigh(list.length) : level === 'medium' ? F.sastMedium(list.length) : F.sastLow(list.length)
    out.push({ severity: level, title, detail: F.sastDetail(sortedUnique(list.map((f) => f.rule)).join(', ')), files: sortedUnique(list.map((f) => f.path)), section: 'security' })
  }
}

function signalFindings(o: Output, out: Finding[]): void {
  securityFindings(o, out)
  const tests = o.signals.testsModified.files
  const removed = tests.reduce((n, t) => n + t.linesRemoved, 0)
  if (tests.length > 0) {
    const deleted = tests.filter((t) => t.status === 'deleted').length
    const severity: Severity = deleted > 0 || removed >= 10 ? 'high' : removed > 0 ? 'medium' : 'low'
    const detail = deleted > 0 ? `${F.testsDeleted(deleted)}. ${F.testsDetail}` : F.testsDetail
    out.push({ severity, title: F.testsLoosened(tests.length, removed), detail, files: tests.map((t) => t.path), section: 'signals' })
  }

  const lint = o.signals.lint
  if (lint.status === 'ok' && lint.changedLines) {
    const errorFiles = sortedUnique(lint.findings.filter((f) => f.severity === 'error').map((f) => f.path))
    const warningFiles = sortedUnique(lint.findings.filter((f) => f.severity === 'warning').map((f) => f.path))
    if (lint.changedLines.errors > 0) out.push({ severity: 'high', title: F.lintErrors(lint.changedLines.errors), files: errorFiles, section: 'signals' })
    if (lint.changedLines.warnings > 0) out.push({ severity: 'low', title: F.lintWarnings(lint.changedLines.warnings), files: warningFiles, section: 'signals' })
  } else {
    out.push({ severity: 'low', title: F.notVerified(F.lintName), detail: lint.message, files: [], section: 'signals' })
  }

  const sup = o.signals.suppressions
  if (sup.items.length > 0) {
    const strong = sup.items.some((i) => STRONG_SUPPRESSIONS.has(i.kind))
    out.push({
      severity: strong ? 'high' : 'medium',
      title: F.suppressions(sup.items.length),
      detail: F.suppressionKinds(sortedUnique(sup.items.map((i) => i.kind)).join(', ')),
      files: sortedUnique(sup.items.map((i) => i.path)),
      section: 'signals',
    })
  }

  const cov = o.signals.coverage
  if (cov.status !== 'ok' || cov.total === null) {
    out.push({ severity: 'low', title: F.notVerified(F.coverageName), detail: cov.message, files: [], section: 'signals' })
    return
  }
  // Severity comes from the files the report knows; files missing from it are a separate finding, because they are
  // often excluded on purpose by the Vitest configuration (types, constants) and would otherwise drown the signal.
  const reported = cov.files.filter((f) => !f.missingFromReport)
  const total = reported.reduce((n, f) => n + f.changedExecutableLines, 0)
  const coveredLines = reported.reduce((n, f) => n + f.coveredLines, 0)
  if (total > 0 && coveredLines / total < COVERAGE_MEDIUM) {
    const gaps = reported.filter((f) => f.uncovered.length > 0).sort((a, b) => b.changedExecutableLines - b.coveredLines - (a.changedExecutableLines - a.coveredLines))
    out.push({
      severity: coveredLines / total < COVERAGE_HIGH ? 'high' : 'medium',
      title: F.coverageLow(percent(coveredLines / total)),
      detail: F.coverageDetail(total - coveredLines, gaps.length),
      files: gaps.slice(0, 8).map((f) => f.path),
      section: 'signals',
    })
  }
  const missing = cov.files.filter((f) => f.missingFromReport)
  if (missing.length > 0) out.push({ severity: 'medium', title: F.coverageMissing(missing.length), detail: F.coverageMissingDetail, files: missing.map((f) => f.path), section: 'signals' })
}

function impactFindings(o: Output, out: Finding[]): void {
  // Risk comes from centrality: how many existing pages and files use each changed file.
  const describe = (f: Output['risk']['files'][number]): string => `${f.path.split('/').pop() ?? f.path} (${f.pagesReached}/${o.risk.totalPages} ${terms(o.surface).many}, ${f.transitiveDependents} dependents)`
  const high = o.risk.files.filter((f) => f.level === 'high')
  const medium = o.risk.files.filter((f) => f.level === 'medium')
  if (high.length > 0) out.push({ severity: 'high', title: F.highRisk(high.length, terms(o.surface)), detail: F.riskDetail(high.slice(0, 6).map(describe).join(', '), terms(o.surface)), files: high.map((f) => f.path), section: 'risk' })
  if (medium.length > 0) out.push({ severity: 'medium', title: F.mediumRisk(medium.length), detail: F.riskDetail(medium.slice(0, 6).map(describe).join(', '), terms(o.surface)), files: medium.map((f) => f.path), section: 'risk' })
  const reached = filesOf(o, 'new-file-reached-by-existing-route')
  if (reached.length > 0) out.push({ severity: 'medium', title: F.newReached(reached.length, terms(o.surface)), detail: F.newReachedDetail(terms(o.surface)), files: reached, section: 'routes' })
  const barrels = filesOf(o, 'barrel-not-additive')
  if (barrels.length > 0) out.push({ severity: 'medium', title: F.barrel(barrels.length), files: barrels, section: 'files' })
  const i18n = filesOf(o, 'i18n-not-additive')
  if (i18n.length > 0) out.push({ severity: 'medium', title: F.i18n(i18n.length), files: i18n, section: 'files' })
  const deleted = filesOf(o, 'existing-file-deleted')
  const renamed = filesOf(o, 'existing-file-renamed')
  if (deleted.length + renamed.length > 0) out.push({ severity: 'medium', title: F.removedFiles(deleted.length, renamed.length), files: [...deleted, ...renamed], section: 'files' })
  const unreachable = filesOf(o, 'existing-file-unreachable')
  if (unreachable.length > 0) out.push({ severity: 'low', title: F.unreachable(unreachable.length), detail: F.unreachableDetail, files: unreachable, section: 'files' })
  if (o.ignoredFiles.length > 0) out.push({ severity: 'low', title: F.ignored(o.ignoredFiles.length), files: o.ignoredFiles, section: 'files' })
  if (o.classification === 'isolated' && !o.reasons.some((r) => REASONS[r.code] !== 'info')) out.push({ severity: 'low', title: F.isolated, detail: F.isolatedDetail, files: [], section: 'overview' })
}

/** Key findings, most severe first (stable within a severity: classification, signals, impact). */
export function keyFindings(output: Output): Finding[] {
  const out: Finding[] = []
  classificationFindings(output, out)
  signalFindings(output, out)
  impactFindings(output, out)
  return out.map((f, i) => ({ f, i })).sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i).map(({ f }) => f)
}
