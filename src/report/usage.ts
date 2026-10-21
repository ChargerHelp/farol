import { DATADOG_SITES } from '../config/schema.js'
import type { Output } from '../output/schema.js'

export interface UsageSummary {
  source: string
  days: number
  kind: 'pages' | 'operations'
  affectedHits: number
  /** Traffic that went to some entry point: the base of the shares (rows of unknown pages and nested GraphQL fields are left out). */
  total: number
  /** Share of every page view / request that goes to the affected entry points (0–100), null without traffic. */
  share: number | null
  /** Distinct errors (Error Tracking issues) seen on the affected entry points. */
  issues: number
}

/** Traffic of the analysis, or null when no usage report was given or it could not be read. */
export function usageSummary(o: Output): UsageSummary | null {
  const u = o.usage
  if (u?.status !== 'ok') return null
  const days = Math.max(1, Math.round((Date.parse(u.to) - Date.parse(u.from)) / 86_400_000))
  return { source: u.source, days, kind: u.kind, affectedHits: u.affectedHits, total: u.matched, share: pct(u.affectedHits, u.matched), issues: u.affectedIssues }
}

function pct(part: number, total: number): number | null {
  return total > 0 ? Math.min(100, Math.round((part / total) * 1000) / 10) : null
}

/** Traffic by entry point key, and by path (summed over the keys sharing it). */
export function usageHits(o: Output): { byKey: Map<string, number>; byPath: Map<string, number>; errorsByKey: Map<string, number>; linkByKey: Map<string, string> } {
  const byKey = new Map<string, number>()
  const byPath = new Map<string, number>()
  const errorsByKey = new Map<string, number>()
  const linkByKey = new Map<string, string>()
  if (o.usage?.status !== 'ok') return { byKey, byPath, errorsByKey, linkByKey }
  const track = o.usage.kind === 'pages' ? 'rum' : 'trace'
  const pathOf = new Map(o.routes.affected.map((r) => [r.key, r.path]))
  for (const e of o.usage.entries) {
    byKey.set(e.key, e.hits)
    errorsByKey.set(e.key, e.issues)
    const url = datadogErrorsUrl(o, e.issueIds, track)
    if (url !== null) linkByKey.set(e.key, url)
    const path = pathOf.get(e.key) ?? e.key
    byPath.set(path, (byPath.get(path) ?? 0) + e.hits)
  }
  return { byKey, byPath, errorsByKey, linkByKey }
}

/** 1234 → "1.2k", 2500000 → "2.5M". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

/**
 * Link to the Datadog explorer listing the errors with these Error Tracking issue ids in the analyzed period: APM
 * traces for operations, RUM sessions for pages. null without a known Datadog site or ids.
 */
export function datadogErrorsUrl(o: Output, ids: readonly string[], track: 'rum' | 'trace'): string | null {
  const u = o.usage
  if (u?.status !== 'ok' || ids.length === 0 || u.site === undefined || !(DATADOG_SITES as readonly string[]).includes(u.site)) return null
  const from = Date.parse(u.from)
  const to = Date.parse(u.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const issues = `@issue.id:(${ids.join(' OR ')})`
  const base = `https://app.${u.site}`
  return track === 'trace'
    ? `${base}/apm/traces?query=${encodeURIComponent(issues)}&start=${from}&end=${to}&paused=true`
    : `${base}/rum/sessions?query=${encodeURIComponent(`@type:error ${issues}`)}&from_ts=${from}&to_ts=${to}&live=false`
}
