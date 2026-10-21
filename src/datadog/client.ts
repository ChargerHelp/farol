import type { UsageIssue, UsageRow } from '../signals/usage.js'

/** Datadog API through native fetch. Only `farol usage` uses it. */
export interface DatadogClientOptions {
  /** One of DATADOG_SITES (validated by the configuration schema). */
  site: string
  apiKey: string
  appKey: string
  fetch?: typeof fetch
}

const MAX_PAGES = 20

export class DatadogError extends Error {}

/** Rows of distinct issue ids per name, from (name, issue id) buckets; buckets without an issue id are left out. */
function issueRows(buckets: readonly { name: unknown; issue: unknown }[]): UsageRow[] {
  const byName = new Map<string, Set<string>>()
  for (const { name, issue } of buckets) {
    if (typeof name !== 'string' || name === '' || typeof issue !== 'string' || issue === '') continue
    byName.set(name, (byName.get(name) ?? new Set()).add(issue))
  }
  return [...byName].map(([name, ids]) => ({ name, count: 0, issues: [...ids].sort() }))
}

export class DatadogClient {
  private readonly base: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: DatadogClientOptions) {
    this.base = `https://api.${options.site}`
    this.fetchImpl = options.fetch ?? fetch
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { 'DD-API-KEY': this.options.apiKey, 'DD-APPLICATION-KEY': this.options.appKey, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok) {
      const hint = response.status === 403 ? ` (check DD_API_KEY, DD_APP_KEY and datadog.site; the application key needs ${path.includes('/spans/') ? 'the apm_read scope' : path.includes('/rum/') ? 'the rum_apps_read scope' : path.includes('/error-tracking/') ? 'the error_tracking_read scope' : 'the timeseries_query scope'})` : ''
      throw new DatadogError(`Datadog API ${method} ${path} failed: HTTP ${response.status}${hint}: ${text.slice(0, 300)}`)
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new DatadogError(`Datadog API ${method} ${path} returned something that is not JSON: ${text.slice(0, 200)}`)
    }
  }

  /** RUM event count per combination of `facets` values for the events matching `query`. */
  private async rumBuckets(query: string, facets: readonly { facet: string; limit: number }[], from: Date, to: Date): Promise<{ by: Record<string, unknown>; count: number }[]> {
    const out: { by: Record<string, unknown>; count: number }[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = {
        compute: [{ aggregation: 'count', type: 'total' }],
        filter: { from: String(from.getTime()), to: String(to.getTime()), query },
        group_by: facets.map((f) => ({ facet: f.facet, limit: f.limit, sort: { aggregation: 'count', order: 'desc', type: 'measure' } })),
        ...(cursor === undefined ? {} : { page: { cursor } }),
      }
      const json = (await this.request('POST', '/api/v2/rum/analytics/aggregate', body)) as { data?: { buckets?: { by?: Record<string, unknown>; computes?: Record<string, unknown> }[] }; meta?: { page?: { after?: string }; status?: string } }
      if (json.meta?.status === 'timeout') throw new DatadogError('Datadog RUM aggregation timed out: try fewer days (datadog.days)')
      for (const bucket of json.data?.buckets ?? []) {
        const count = Number(Object.values(bucket.computes ?? {})[0] ?? 0)
        if (Number.isFinite(count)) out.push({ by: bucket.by ?? {}, count })
      }
      cursor = json.meta?.page?.after
      if (cursor === undefined || cursor === '') return out
    }
    throw new DatadogError(`Datadog RUM aggregation has more than ${MAX_PAGES} pages of ${facets.map((f) => f.facet).join(', ')} values`)
  }

  /** RUM view count per value of `facet` (e.g. `@view.url_path_group`) for the events matching `query`. */
  async rumViews(query: string, facet: string, from: Date, to: Date): Promise<UsageRow[]> {
    const buckets = await this.rumBuckets(query, [{ facet, limit: 1000 }], from, to)
    return buckets.flatMap((b) => (typeof b.by[facet] === 'string' && b.by[facet] !== '' ? [{ name: b.by[facet], count: b.count }] : []))
  }

  /** Distinct errors (Error Tracking issue ids) per value of `facet`, from RUM errors matching `query`. */
  async rumIssues(query: string, facet: string, from: Date, to: Date): Promise<UsageRow[]> {
    // Datadog allows at most 10,000 groups across all dimensions.
    const buckets = await this.rumBuckets(query, [{ facet, limit: 200 }, { facet: '@issue.id', limit: 50 }], from, to)
    return issueRows(buckets.map((b) => ({ name: b.by[facet], issue: b.by['@issue.id'] })))
  }

  /**
   * Who calls a service: indexed client spans whose peer.service is it, per calling service, method and URL path
   * (`POST /v1/metric/performance`). Counts are of indexed spans (a sample), good for comparing callers.
   */
  async spanCallers(peer: string, from: Date, to: Date): Promise<{ name: string; service: string; count: number }[]> {
    const body = {
      data: {
        type: 'aggregate_request',
        attributes: {
          compute: [{ aggregation: 'count', type: 'total' }],
          filter: { from: String(from.getTime()), to: String(to.getTime()), query: `@peer.service:${peer}` },
          // Datadog allows at most 10,000 groups across all dimensions.
          group_by: ['service', '@http.method', '@http.url_details.path'].map((facet, i) => ({ facet, limit: [40, 5, 50][i], sort: { aggregation: 'count', order: 'desc', type: 'measure' } })),
        },
      },
    }
    const json = (await this.request('POST', '/api/v2/spans/analytics/aggregate', body)) as { data?: { attributes?: { by?: Record<string, unknown>; compute?: Record<string, unknown>; computes?: Record<string, unknown> } }[]; meta?: { status?: string } }
    if (json.meta?.status === 'timeout') throw new DatadogError('Datadog span aggregation timed out: try fewer days (datadog.days)')
    const out: { name: string; service: string; count: number }[] = []
    for (const b of json.data ?? []) {
      const by = b.attributes?.by ?? {}
      const service = by.service
      const method = by['@http.method']
      const path = by['@http.url_details.path']
      // The API returns the values under `compute` (the reference also documents `computes`).
      const count = Number(Object.values(b.attributes?.compute ?? b.attributes?.computes ?? {})[0] ?? 0)
      if (typeof service !== 'string' || typeof path !== 'string' || path === '' || service === peer || !Number.isFinite(count)) continue
      out.push({ name: typeof method === 'string' && method !== '' ? `${method} ${path}` : path, service, count })
    }
    return out
  }

  /** Distinct errors (Error Tracking issue ids) per resource, from the error spans matching `query`. */
  async spanIssues(query: string, from: Date, to: Date): Promise<UsageRow[]> {
    const body = {
      data: {
        type: 'aggregate_request',
        attributes: {
          compute: [{ aggregation: 'count', type: 'total' }],
          filter: { from: String(from.getTime()), to: String(to.getTime()), query },
          group_by: [{ facet: 'resource_name', limit: 200 }, { facet: '@issue.id', limit: 50 }],
        },
      },
    }
    const json = (await this.request('POST', '/api/v2/spans/analytics/aggregate', body)) as { data?: { attributes?: { by?: Record<string, unknown> } }[]; meta?: { status?: string } }
    if (json.meta?.status === 'timeout') throw new DatadogError('Datadog span aggregation timed out: try fewer days (datadog.days)')
    return issueRows((json.data ?? []).map((b) => ({ name: b.attributes?.by?.resource_name, issue: b.attributes?.by?.['@issue.id'] })))
  }

  /**
   * Error Tracking issues of a track (`trace` for APM, `rum` for browsers) matching `query`, most errors first (the API
   * returns at most 100). Issues without a file (no or unparseable stack trace) are left out.
   */
  async errorIssues(query: string, track: 'trace' | 'rum', from: Date, to: Date): Promise<UsageIssue[]> {
    const body = { data: { type: 'search_request', attributes: { query, from: from.getTime(), to: to.getTime(), track, order_by: 'TOTAL_COUNT' } } }
    const json = (await this.request('POST', '/api/v2/error-tracking/issues/search?include=issue', body)) as {
      data?: { attributes?: { total_count?: number }; relationships?: { issue?: { data?: { id?: string } } } }[]
      included?: { id?: string; type?: string; attributes?: { file_path?: string; error_type?: string; function_name?: string } }[]
    }
    const issues = new Map((json.included ?? []).filter((i) => i.type === 'issue' && i.id !== undefined).map((i) => [i.id, i.attributes ?? {}]))
    const out: UsageIssue[] = []
    for (const result of json.data ?? []) {
      const id = result.relationships?.issue?.data?.id
      const issue = issues.get(id)
      const file = issue?.file_path
      if (issue === undefined || file === undefined || file === '') continue
      out.push({ file, count: result.attributes?.total_count ?? 0, type: issue.error_type ?? '', ...(issue.function_name ? { function: issue.function_name } : {}), ...(id === undefined ? {} : { id }), track })
    }
    return out
  }

  /** Sum of a metric query grouped by one tag over the period, e.g. `sum:trace.http.request.hits{service:x} by {resource_name}.as_count()`. */
  async metricByTag(query: string, tag: string, from: Date, to: Date): Promise<UsageRow[]> {
    const groups = await this.metricGroups(query, [tag], from, to)
    return groups.map((g) => ({ name: g.tags[tag] ?? '', count: g.count }))
  }

  /** Sum of a metric query over the period per combination of `tags` values (series missing a tag are left out). */
  async metricGroups(query: string, tags: readonly string[], from: Date, to: Date): Promise<{ tags: Record<string, string>; count: number }[]> {
    const params = new URLSearchParams({ from: String(Math.floor(from.getTime() / 1000)), to: String(Math.floor(to.getTime() / 1000)), query })
    const json = (await this.request('GET', `/api/v1/query?${params.toString()}`)) as { status?: string; error?: string; series?: { tag_set?: string[]; pointlist?: [number, number | null][] }[] }
    if (json.status === 'error') throw new DatadogError(`Datadog metric query failed: ${json.error ?? 'unknown error'} (query: ${query})`)
    const totals = new Map<string, { tags: Record<string, string>; count: number }>()
    for (const series of json.series ?? []) {
      const values: Record<string, string> = {}
      for (const tag of tags) {
        const value = series.tag_set?.find((t) => t.startsWith(`${tag}:`))?.slice(tag.length + 1)
        if (value !== undefined && value !== '') values[tag] = value
      }
      if (Object.keys(values).length < tags.length) continue
      const sum = (series.pointlist ?? []).reduce((n, [, v]) => n + (v ?? 0), 0)
      const id = tags.map((t) => values[t]).join('\n')
      const prev = totals.get(id) ?? { tags: values, count: 0 }
      prev.count += sum
      totals.set(id, prev)
    }
    return [...totals.values()]
  }
}
