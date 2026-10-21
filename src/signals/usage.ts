import { z } from 'zod'
import type { Output } from '../output/schema.js'
import { compareStrings } from '../output/order.js'
import { ReportError } from './coverage.js'
import { errorFiles } from './error-files.js'

/**
 * count: page views or requests; issues: ids of the distinct errors (Error Tracking issues) seen on the page or the
 * operation; service: the APM service of the row, when several are read.
 */
const UsageRowSchema = z.object({ name: z.string().min(1), count: z.number().nonnegative(), issues: z.array(z.string().min(1)).optional(), service: z.string().optional() }).strict()

/** One Error Tracking issue: the file of its top stack frame (as reported), its error count and type. */
const IssueSchema = z.object({ file: z.string().min(1), count: z.number().nonnegative(), type: z.string(), function: z.string().optional(), id: z.string().optional(), track: z.enum(['rum', 'trace']).optional() }).strict()

/** usage.json, written by `farol usage` (or by hand from any other source): traffic per page and per operation. */
export const UsageFileSchema = z
  .object({
    farolUsage: z.literal(1),
    /** Datadog site the numbers come from (for links to its explorers). */
    site: z.string().optional(),
    /** Where the numbers come from, e.g. "Datadog RUM + APM". */
    source: z.string().min(1),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    /** Page views by URL path (RUM `@view.url_path_group`): `/org/?/reports`, `/org/:id/reports`. */
    pages: z.array(UsageRowSchema).default([]),
    /** Requests by operation (APM `resource_name`): `GET /brands/{id}`, `get_/brands/_id_`, `/pkg.Service/Method`. */
    operations: z.array(UsageRowSchema).default([]),
    /** Calls other services make to this one (client spans with `peer.service`): the resource as the caller names it. */
    callers: z.array(z.object({ name: z.string().min(1), service: z.string().min(1), count: z.number().nonnegative() }).strict()).default([]),
    /** Error Tracking issues with a file (`../../apps/web/src/x.tsx`, `/app/dist/modules/x.service.js`). */
    issues: z.array(IssueSchema).default([]),
  })
  .strict()

export type UsageFile = z.infer<typeof UsageFileSchema>
export type UsageRow = z.infer<typeof UsageRowSchema>
export type UsageIssue = z.infer<typeof IssueSchema>
export type Usage = NonNullable<Output['usage']>

/** Issue ids kept per entry point or file, for links to Datadog. */
const MAX_LINKED_ISSUES = 20

export function parseUsageFile(text: string): UsageFile {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new ReportError(`usage report is not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = UsageFileSchema.safeParse(json)
  if (!parsed.success) throw new ReportError(`usage report is not a farol usage file (run "farol usage"): ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY', 'WS', 'WEBSOCKET'])

/**
 * Datadog's metric tag normalization, applied to both sides: lowercase; characters other than letters, digits, `_`,
 * `-`, `:`, `.` and `/` become `_`; runs of `_` collapse; leading and trailing `_` go.
 */
function canon(text: string): string {
  let out = ''
  for (const ch of text.toLowerCase()) {
    const ok = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '-' || ch === ':' || ch === '.' || ch === '/'
    const c = ok ? ch : '_'
    if (c === '_' && out.endsWith('_')) continue
    out += c
  }
  let start = 0
  let end = out.length
  while (start < end && out[start] === '_') start++
  while (end > start && out[end - 1] === '_') end--
  return out.slice(start, end)
}

/** Route path segments that match any value: `:id`, `{id}`, `<str:id>`, `*`, `*splat`. */
function isVariable(segment: string): boolean {
  return segment.startsWith(':') || segment.startsWith('*') || (segment.startsWith('{') && segment.endsWith('}')) || (segment.startsWith('<') && segment.endsWith('>'))
}

interface Pattern {
  /** Upper-case method, or null when any method matches. */
  method: string | null
  /** null: a name without a path (jobs, flows, GraphQL fields), compared whole. */
  segments: { text: string; variable: boolean }[] | null
  whole: string
  /** The name without its kind (`FLOW brand-sync` → `brand-sync`), as tracers name such spans. */
  name: string
  /** GraphQL root field (`Query.getBrand` → `getbrand`): `graphql.resolve` resources are `getbrand:brand`. */
  field?: string
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/** Pattern of an entry point: `/org/:id`, `GET /brands/{id}`, `api GET /items` (service label), `RPC pkg.S/M`. */
export function entryPattern(key: string): Pattern {
  const name = canon(key.includes(' ') ? key.slice(key.indexOf(' ') + 1) : key)
  if (key.startsWith('RPC ')) return { method: null, segments: splitPath(key.slice(4)).map((text) => ({ text: canon(text), variable: false })), whole: canon(key), name }
  const tokens = key.split(' ')
  const at = tokens.findIndex((t) => t.startsWith('/'))
  const dot = key.indexOf('.')
  if (at < 0 && tokens.length === 1 && dot > 0 && ['Query', 'Mutation', 'Subscription'].includes(key.slice(0, dot))) return { method: null, segments: null, whole: canon(key), name, field: canon(key.slice(dot + 1)) }
  if (at < 0) return { method: null, segments: null, whole: canon(key), name }
  const before = tokens[at - 1]?.toUpperCase()
  const method = before !== undefined && METHODS.has(before) && before !== 'ANY' ? before : null
  const segments = splitPath(tokens.slice(at).join(' ')).map((s) => (isVariable(s) ? { text: '', variable: true } : { text: canon(s), variable: false }))
  return { method, segments, whole: canon(key), name }
}

/** Method and path segments of a traffic row: `GET /x/{id}`, `get_/x/_id_` (a metric tag), `/x/?` (RUM). */
function rowPattern(name: string): { method: string | null; segments: string[] | null; whole: string } {
  const slash = name.indexOf('/')
  if (slash < 0) return { method: null, segments: null, whole: canon(name) }
  const prefix = canon(name.slice(0, slash)).toUpperCase()
  return { method: METHODS.has(prefix) ? prefix : null, segments: splitPath(name.slice(slash)).map(canon), whole: canon(name) }
}

/** Literal segments matched when the row matches the pattern; -1 when it does not. */
function matchScore(p: Pattern, row: ReturnType<typeof rowPattern>): number {
  if (p.field !== undefined && row.segments === null && row.whole.startsWith(`${p.field}:`)) return 1
  if (p.segments === null || row.segments === null) return p.whole === row.whole ? 2 : p.name === row.whole ? 1 : -1
  if (p.method !== null && row.method !== null && p.method !== row.method) return -1
  if (p.segments.length !== row.segments.length) return -1
  let literal = 0
  for (const [i, seg] of p.segments.entries()) {
    const value = row.segments[i] ?? ''
    if (seg.variable) continue
    if (seg.text !== value) return -1
    literal++
  }
  return literal
}

/** Letters and digits only: `orders_api` is part of `shop-orders-api`. */
function alnum(text: string): string {
  let out = ''
  for (const ch of text.toLowerCase()) if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) out += ch
  return out
}

/** Service label of a key (`orders_api GET /carts` → `orders_api`), when it has one. */
function labelOf(key: string): string | undefined {
  const tokens = key.split(' ')
  return tokens.length >= 3 && METHODS.has(tokens[1] ?? '') ? tokens[0] : undefined
}

const HEALTH = new Set(['health', 'healthz', 'healthcheck', 'health-check', 'ping', 'readiness', 'readyz', 'liveness', 'livez', 'liveliness', 'ready', 'live', 'alive', 'metrics'])

/** Health checks and metrics scrapes: probes, not users; they would dwarf real traffic. */
export function isProbe(name: string): boolean {
  const segments = rowPattern(name).segments ?? []
  return segments.length > 0 && segments.length <= 2 && HEALTH.has(segments[segments.length - 1] ?? '')
}

/**
 * Traffic of each entry point: every row goes to the entry points it matches with the most literal segments (so
 * `/brands/count` goes to `GET /brands/count`, not to `GET /brands/{id}`), split evenly when several tie. A row of a
 * Datadog service only goes to keys labeled with that service when there are such keys (`orders_api …` for
 * `shop-orders-api`). Also returns the traffic that went to some entry point.
 */
export type Assigned = { count: number; issues: Set<string> }

export function assignUsage(keys: readonly string[], rows: readonly UsageRow[]): Map<string, Assigned> & { matched?: Assigned } {
  const patterns = keys.map((key) => ({ key, pattern: entryPattern(key), label: labelOf(key) }))
  const hits: Map<string, Assigned> & { matched?: Assigned } = new Map()
  const matched: Assigned = { count: 0, issues: new Set() }
  for (const row of rows) {
    const rp = rowPattern(row.name)
    const service = row.service === undefined ? '' : alnum(row.service)
    const own = service === '' ? [] : patterns.filter((p) => p.label !== undefined && alnum(p.label) !== '' && service.includes(alnum(p.label)))
    let best = 0
    let winners: string[] = []
    for (const { key, pattern } of own.length > 0 ? own : patterns) {
      const score = matchScore(pattern, rp)
      if (score < 0) continue
      if (winners.length === 0 || score > best) {
        best = score
        winners = [key]
      } else if (score === best) winners.push(key)
    }
    if (winners.length === 0) continue
    matched.count += row.count
    for (const id of row.issues ?? []) matched.issues.add(id)
    for (const key of winners) {
      const entry = hits.get(key) ?? { count: 0, issues: new Set<string>() }
      // Distinct errors are not split: an error seen on a tied row was seen on each of its entry points.
      entry.count += row.count / winners.length
      for (const id of row.issues ?? []) entry.issues.add(id)
      hits.set(key, entry)
    }
  }
  hits.matched = matched
  return hits
}

export interface UsageInput {
  surface: 'frontend' | 'backend'
  /** Every entry point of the head (key), and whether it wraps other routes (layouts get no traffic of their own). */
  entries: readonly { key: string; path: string; hasChildren: boolean }[]
  /** Keys of the existing entry points this PR affects. */
  affected: readonly string[]
  /** Repo-relative paths of the changed files (matched against Error Tracking issues). */
  changedFiles: readonly string[]
  /** Entry points whose callers to list (those with contract changes, including removed ones). */
  callersOf?: readonly string[]
}

/** Services that call each of `keys`, busiest first, from the caller rows (matched like operations). */
export function callersOf(keys: readonly string[], rows: UsageFile['callers']): { key: string; services: { service: string; hits: number }[] }[] {
  const byService = new Map<string, UsageRow[]>()
  for (const r of rows) byService.set(r.service, [...(byService.get(r.service) ?? []), { name: r.name, count: r.count }])
  const out = new Map<string, Map<string, number>>()
  for (const [service, list] of byService) {
    for (const [key, n] of assignUsage(keys, list)) {
      if (n.count <= 0) continue
      const services = out.get(key) ?? new Map<string, number>()
      services.set(service, (services.get(service) ?? 0) + n.count)
      out.set(key, services)
    }
  }
  return [...out]
    .map(([key, services]) => ({ key, services: [...services].map(([service, hits]) => ({ service, hits: Math.round(hits) })).sort((a, b) => b.hits - a.hits || compareStrings(a.service, b.service)) }))
    .sort((a, b) => compareStrings(a.key, b.key))
}

/** Traffic of the affected pages (frontend, RUM) or operations (backend, APM). */
export function usageSignal(file: UsageFile, input: UsageInput): Usage {
  const rows = (input.surface === 'frontend' ? file.pages : file.operations).filter((r) => !isProbe(r.name))
  const own = input.entries.filter((e) => !e.hasChildren)
  // Pages are matched by URL path, operations by key (method + path, or the name).
  const byMatchKey = new Map(own.map((e) => [input.surface === 'frontend' ? e.path : e.key, e.key]))
  const assigned = assignUsage([...byMatchKey.keys()], rows)
  const hits = new Map([...assigned].map(([matchKey, n]) => [byMatchKey.get(matchKey) ?? matchKey, n]))
  const total = rows.reduce((n, r) => n + r.count, 0)
  const allIssues = new Set(rows.flatMap((r) => r.issues ?? []))
  const affected = new Set(input.affected)
  const entries = [...hits]
    .filter(([key, n]) => affected.has(key) && (n.count > 0 || n.issues.size > 0))
    .map(([key, n]) => ({ key, hits: Math.round(n.count), issues: n.issues.size, issueIds: [...n.issues].sort(compareStrings).slice(0, MAX_LINKED_ISSUES) }))
    .sort((a, b) => b.hits - a.hits || b.issues - a.issues || compareStrings(a.key, b.key))
  const affectedIssues = new Set([...hits].filter(([key]) => affected.has(key)).flatMap(([, n]) => [...n.issues]))
  return {
    status: 'ok',
    ...(file.site === undefined ? {} : { site: file.site }),
    source: file.source,
    from: file.from,
    to: file.to,
    kind: input.surface === 'frontend' ? 'pages' : 'operations',
    total: Math.round(total),
    matched: Math.round(assigned.matched?.count ?? 0),
    affectedHits: entries.reduce((n, e) => n + e.hits, 0),
    totalIssues: allIssues.size,
    matchedIssues: assigned.matched?.issues.size ?? 0,
    affectedIssues: affectedIssues.size,
    entries,
    files: errorFiles(input.changedFiles, file.issues),
    callers: input.callersOf === undefined || input.callersOf.length === 0 ? [] : callersOf(input.callersOf, file.callers),
  }
}
