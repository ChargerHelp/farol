import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConfigSchema } from '../../src/config/schema.js'
import { runUsage } from '../../src/cli/usage.js'
import type { Context } from '../../src/cli/context.js'
import { DatadogClient } from '../../src/datadog/client.js'
import { OutputSchema } from '../../src/output/schema.js'
import { renderHtml } from '../../src/report/html.js'
import { renderReport } from '../../src/report/markdown.js'
import { compactNumber } from '../../src/report/usage.js'
import { assignUsage, callersOf, isProbe, parseUsageFile, usageSignal, type UsageFile } from '../../src/signals/usage.js'
import { errorFiles, matchReportedFile } from '../../src/signals/error-files.js'
import { analyzeRepo } from '../helpers/analyze.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

const repos: ScenarioRepo[] = []
const tmp = mkdtempSync(join(tmpdir(), 'farol-usage-'))
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
  rmSync(tmp, { recursive: true, force: true })
})

const file = (rows: Partial<UsageFile>): UsageFile => ({ farolUsage: 1, source: 'Datadog RUM', from: '2026-10-04T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z', pages: [], operations: [], callers: [], issues: [], ...rows })
const counts = (m: Map<string, { count: number }>): Record<string, number> => Object.fromEntries([...m].map(([k, v]) => [k, v.count]))

describe('assignUsage', () => {
  it('matches RUM path groups and literal values to route paths, preferring the most literal route', () => {
    const hits = assignUsage(['/org/:id/reports', '/org/:id', '/brands/new', '/brands/:brandId', '/'], [
      { name: '/org/?/reports', count: 10 },
      { name: '/org/abc123/reports', count: 2 },
      { name: '/org/?', count: 5 },
      { name: '/brands/new', count: 3 },
      { name: '/brands/?', count: 7 },
      { name: '/', count: 1 },
      { name: '/unknown/page', count: 100 },
    ])
    expect(counts(hits)).toEqual({ '/org/:id/reports': 12, '/org/:id': 5, '/brands/new': 3, '/brands/:brandId': 7, '/': 1 })
  })

  it('matches APM resources: raw, normalized metric tags, ANY routes, service labels, gRPC and names', () => {
    const keys = ['GET /brands/{brand_id}', 'GET /brands/count', 'POST /brands', 'ANY /items/<str:item_id>/', 'api GET /carts', 'RPC brandspb.Brands/GetBrand', 'FLOW brand-sync', 'Query.getCatalog']
    const hits = assignUsage(keys, [
      { name: 'GET /brands/{brand_id}', count: 4 },
      { name: 'get_/brands/_brand_id', count: 6 },
      { name: 'get_/brands/count', count: 1 },
      { name: 'post_/brands', count: 2 },
      { name: 'DELETE /items/{id}', count: 3 },
      { name: 'get_/carts', count: 8 },
      { name: '/brandspb.Brands/GetBrand', count: 9 },
      { name: 'brand-sync', count: 5 },
      { name: 'getcatalog:cataloginterface', count: 11 },
      { name: 'title:string', count: 99 },
      { name: 'put_/brands', count: 50 },
    ])
    expect(counts(hits)).toEqual({ 'GET /brands/{brand_id}': 10, 'GET /brands/count': 1, 'POST /brands': 2, 'ANY /items/<str:item_id>/': 3, 'api GET /carts': 8, 'RPC brandspb.Brands/GetBrand': 9, 'FLOW brand-sync': 5, 'Query.getCatalog': 11 })
  })
})

describe('error files', () => {
  it('maps reported files to changed files by path suffix, ignoring dependencies and bundles', () => {
    const changed = ['apps/web/src/components/CartModal/index.tsx', 'src/modules/catalog/services/list.service.ts', 'src/main.ts', 'src/shop/store.py', 'src/a/utils/index.ts', 'src/b/utils/index.ts']
    expect(matchReportedFile('../../../apps/web/src/components/CartModal/index.jsx', changed)).toBe('apps/web/src/components/CartModal/index.tsx')
    expect(matchReportedFile('/home/dist/modules/catalog/services/list.service.js', changed)).toBe('src/modules/catalog/services/list.service.ts')
    expect(matchReportedFile('/app/src/shop/store.py', changed)).toBe('src/shop/store.py')
    expect(matchReportedFile('/app/dist/main.js', changed)).toBeNull()
    expect(matchReportedFile('../../node_modules/.pnpm/x/node_modules/x/index.js', changed)).toBeNull()
    expect(matchReportedFile('/app/.venv/lib/python3.12/site-packages/src/shop/store.py', changed)).toBeNull()
    expect(matchReportedFile('node:_http_client', changed)).toBeNull()
    expect(matchReportedFile('webpack:///./utils/index.js', changed)).toBeNull()
    expect(errorFiles(changed, [
      { file: '/app/src/shop/store.py', count: 40, type: 'KeyError' },
      { file: '/srv/src/shop/store.py', count: 2, type: 'TypeError' },
      { file: '/app/dist/main.js', count: 900, type: 'Error' },
    ])).toEqual([{ path: 'src/shop/store.py', errors: 42, issues: 2, types: ['KeyError', 'TypeError'], issueIds: [] }])
  })
})

describe('callers', () => {
  it('lists the services that call each entry point, busiest first', () => {
    expect(callersOf(['GET /brands/{id}', 'POST /brands'], [
      { name: 'get_/brands/_id_', service: 'web-bff', count: 30 },
      { name: 'GET /brands/42', service: 'worker', count: 5 },
      { name: 'post_/brands', service: 'web-bff', count: 2 },
      { name: 'get_/other', service: 'web-bff', count: 99 },
    ])).toEqual([
      { key: 'GET /brands/{id}', services: [{ service: 'web-bff', hits: 30 }, { service: 'worker', hits: 5 }] },
      { key: 'POST /brands', services: [{ service: 'web-bff', hits: 2 }] },
    ])
  })
})

describe('services and probes', () => {
  it('sends rows of a service to the keys labeled with it, splits ties and leaves health checks out', () => {
    const hits = assignUsage(['orders_api GET /healthz', 'billing GET /healthz', 'orders_api GET /carts', 'billing GET /carts', 'GET /x/{a}', 'GET /x/{b}'], [
      { name: 'get_/carts', count: 10, service: 'shop-orders-api' },
      { name: 'get_/carts', count: 4, service: 'shop-billing' },
      { name: 'get_/x/1', count: 6 },
    ])
    expect(counts(hits)).toEqual({ 'orders_api GET /carts': 10, 'billing GET /carts': 4, 'GET /x/{a}': 3, 'GET /x/{b}': 3 })
    expect(hits.matched?.count).toBe(20)
    expect(['/healthz', '/health/readiness', '/healthcheck/ping', '/metrics', 'get_/healthz', 'get_/health/readiness', '/brands/health-report'].map(isProbe)).toEqual([true, true, true, true, true, true, false])
  })
})

describe('usageSignal', () => {
  it('reports the traffic of affected pages only, busiest first, skipping layouts', () => {
    const u = usageSignal(file({ pages: [{ name: '/', count: 50 }, { name: '/products', count: 30 }, { name: '/about', count: 20 }] }), {
      surface: 'frontend',
      entries: [
        { key: '/', path: '/', hasChildren: true },
        { key: '/ > (index)', path: '/', hasChildren: false },
        { key: '/ > products', path: '/products', hasChildren: false },
        { key: '/ > about', path: '/about', hasChildren: false },
      ],
      affected: ['/', '/ > (index)', '/ > products'],
      changedFiles: [],
    })
    expect(u).toEqual({ status: 'ok', source: 'Datadog RUM', from: '2026-10-04T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z', kind: 'pages', total: 100, matched: 100, affectedHits: 80, totalIssues: 0, matchedIssues: 0, affectedIssues: 0, entries: [{ key: '/ > (index)', hits: 50, issues: 0, issueIds: [] }, { key: '/ > products', hits: 30, issues: 0, issueIds: [] }], files: [], callers: [] })
  })

  it('rejects files that are not usage reports', () => {
    expect(() => parseUsageFile('{"pages": []}')).toThrow(/not a farol usage file/)
    expect(() => parseUsageFile('nope')).toThrow(/not JSON/)
  })
})

describe('Datadog client', () => {
  it('pages through RUM aggregations and sums metric series by tag', async () => {
    const calls: { url: string; body?: string; headers: Record<string, string> }[] = []
    const fake = (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, ...(typeof init?.body === 'string' ? { body: init.body } : {}), headers: init?.headers as Record<string, string> })
      if (url.includes('/rum/')) {
        const cursor = (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { page?: { cursor: string } }).page?.cursor
        const json = cursor === undefined
          ? { data: { buckets: [{ by: { '@view.url_path_group': '/a' }, computes: { c0: 3 } }] }, meta: { status: 'done', page: { after: 'next' } } }
          : { data: { buckets: [{ by: { '@view.url_path_group': '/b' }, computes: { c0: 4 } }] }, meta: { status: 'done' } }
        return Promise.resolve(new Response(JSON.stringify(json)))
      }
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok', series: [{ tag_set: ['resource_name:get_/a'], pointlist: [[1, 2], [2, null], [3, 5]] }] })))
    }
    const client = new DatadogClient({ site: 'datadoghq.eu', apiKey: 'k', appKey: 'a', fetch: fake as typeof fetch })
    const from = new Date('2026-10-04T00:00:00Z')
    const to = new Date('2026-10-18T00:00:00Z')
    expect(await client.rumViews('@type:view', '@view.url_path_group', from, to)).toEqual([{ name: '/a', count: 3 }, { name: '/b', count: 4 }])
    expect(await client.metricByTag('sum:trace.http.request.hits{service:x} by {resource_name}.as_count()', 'resource_name', from, to)).toEqual([{ name: 'get_/a', count: 7 }])
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['api.datadoghq.eu', 'api.datadoghq.eu', 'api.datadoghq.eu'])
    expect(calls[0]?.headers['DD-API-KEY']).toBe('k')
  })

  it('explains HTTP errors', async () => {
    const client = new DatadogClient({ site: 'datadoghq.com', apiKey: 'k', appKey: 'a', fetch: (() => Promise.resolve(new Response('{"errors":["Forbidden"]}', { status: 403 }))) })
    await expect(client.metricByTag('q', 'resource_name', new Date(0), new Date(1000))).rejects.toThrow(/HTTP 403 \(check DD_API_KEY/)
  })
})

describe('farol usage', () => {
  const ctx = (datadog: unknown): Context => ({ config: ConfigSchema.parse({ surface: 'backend', datadog }), projectDir: tmp, repoRoot: tmp, projectPrefix: '', configPath: '', verbose: false, log: () => undefined })

  it('builds a usage report from APM metrics and Error Tracking, and needs the keys', async () => {
    const queries: string[] = []
    const fake = ((url: string, init?: RequestInit) => {
      if (url.includes('/error-tracking/')) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { data: { attributes: { query: string; track: string } } }
        queries.push(`${body.data.attributes.track}: ${body.data.attributes.query}`)
        return Promise.resolve(new Response(JSON.stringify({
          data: [
            { attributes: { total_count: 40 }, relationships: { issue: { data: { id: 'i1' } } } },
            { attributes: { total_count: 9 }, relationships: { issue: { data: { id: 'i2' } } } },
          ],
          included: [{ id: 'i1', type: 'issue', attributes: { file_path: '/app/src/shop/store.py', error_type: 'KeyError', function_name: 'find' } }, { id: 'i2', type: 'issue', attributes: { error_type: 'Timeout' } }],
        })))
      }
      if (url.includes('/spans/')) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { data: { attributes: { filter: { query: string } } } }
        queries.push(`spans: ${body.data.attributes.filter.query}`)
        if (body.data.attributes.filter.query.startsWith('@peer.service:')) {
          const call = (service: string, method: string, path: string, count: number) => ({ attributes: { by: { service, '@http.method': method, '@http.url_details.path': path }, compute: { c0: count } } })
          return Promise.resolve(new Response(JSON.stringify({ data: [call('web-bff', 'GET', '/b/42', 7), call('api', 'GET', '/self', 3)], meta: { status: 'done' } })))
        }
        const bucket = (resource: string, issue?: string) => ({ attributes: { by: { resource_name: resource, ...(issue ? { '@issue.id': issue } : {}) } } })
        return Promise.resolve(new Response(JSON.stringify({ data: [bucket('GET /b', 'i1'), bucket('GET /b', 'i2'), bucket('GET /b', 'i1'), bucket('GET /a')], meta: { status: 'done' } })))
      }
      const query = new URL(url).searchParams.get('query') ?? ''
      queries.push(query)
      const series = [{ tag_set: ['resource_name:get_/b'], pointlist: [[1, 2]] }, { tag_set: ['resource_name:get_/a'], pointlist: [[1, 1.4]] }]
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok', series })))
    }) as typeof fetch
    const c = ctx({ env: 'prod', apm: { service: 'api', operations: ['fastapi.request'] } })
    const report = await runUsage(c, {}, { DD_API_KEY: 'k', DD_APP_KEY: 'a' }, new Date('2026-10-18T00:00:00Z'), fake)
    expect(queries).toEqual([
      'sum:trace.fastapi.request.hits{service:api,env:prod} by {resource_name}.as_count()',
      'spans: service:api env:prod status:error',
      'trace: service:api env:prod',
      'spans: @peer.service:api',
    ])
    expect(report).toEqual({
      farolUsage: 1, site: 'datadoghq.com', source: 'Datadog APM', from: '2026-10-04T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z', pages: [],
      operations: [{ name: 'GET /b', count: 0, issues: ['i1', 'i2'] }, { name: 'get_/a', count: 1 }, { name: 'get_/b', count: 2 }],
      callers: [{ name: 'GET /b/42', service: 'web-bff', count: 7 }],
      issues: [{ file: '/app/src/shop/store.py', count: 40, type: 'KeyError', function: 'find', id: 'i1', track: 'trace' }],
    })
    await expect(runUsage(c, {}, {}, new Date(), fake)).rejects.toThrow(/DD_API_KEY and DD_APP_KEY/)
  })

  it('only accepts known Datadog sites and safe names', () => {
    expect(() => ConfigSchema.parse({ surface: 'backend', datadog: { site: 'evil.example.com', apm: { service: 'x', operations: ['http.request'] } } })).toThrow()
    expect(() => ConfigSchema.parse({ surface: 'backend', datadog: { apm: { service: 'x} OR {y', operations: ['http.request'] } } })).toThrow()
    expect(() => ConfigSchema.parse({ surface: 'backend', datadog: {} })).toThrow(/datadog.rum/)
  })
})

describe('analyze --usage', () => {
  it('adds the traffic of the affected pages to the output, the comment and the HTML', async () => {
    const s = createScenarioRepo('05-shared-component')
    repos.push(s)
    const path = join(tmp, 'usage.json')
    writeFileSync(path, JSON.stringify(file({ pages: [{ name: '/', count: 1500, issues: ['a', 'b'] }, { name: '/products', count: 300, issues: ['b'] }, { name: '/about', count: 200, issues: ['c'] }], issues: [{ file: '/build/../src/components/Card.tsx', count: 1200, type: 'TypeError' }] })))
    const { output } = await analyzeRepo(s.repo, { usage: path })
    expect(OutputSchema.parse(output).usage).toMatchObject({ status: 'ok', kind: 'pages', total: 2000, affectedHits: 1800, totalIssues: 3, matchedIssues: 3, affectedIssues: 2, entries: [{ key: '/ > (index)', hits: 1500, issues: 2, issueIds: ['a', 'b'] }, { key: '/ > products', hits: 300, issues: 1, issueIds: ['b'] }] })
    expect(output.usage?.files).toEqual([{ path: 'src/components/Card.tsx', errors: 1200, issues: 1, types: ['TypeError'], issueIds: [] }])
    const md = renderReport(output)
    expect(md).toContain('**Traffic:** the affected pages get 90% of page views (1.8k of 2.0k attributed to pages; Datadog RUM, last 14 days); 2 distinct errors on them (Error Tracking issues)')
    expect(md).toContain('`/` 1.5k views, 2 distinct errors')
    const html = renderHtml(output)
    expect(html).toContain('90% of page views')
    expect(html).toContain('<span class="chip traffic">1.5k views, 2 distinct errors</span>')

    // With the Datadog site, distinct errors link to the explorer filtered by their issue ids.
    const linked = join(tmp, 'linked.json')
    writeFileSync(linked, JSON.stringify(file({ site: 'datadoghq.eu', pages: [{ name: '/', count: 1500, issues: ['a', 'b'] }] })))
    const out = (await analyzeRepo(s.repo, { usage: linked })).output
    const url = 'https://app.datadoghq.eu/rum/sessions?query=%40type%3Aerror%20%40issue.id%3A(a%20OR%20b)&from_ts=1791072000000&to_ts=1792281600000&live=false'
    expect(renderReport(out)).toContain(`[2 distinct errors](${url})`)
    expect(renderHtml(out)).toContain(`<a class="dd-link" href="${url.replaceAll('&', '&amp;')}"`)
    expect(md).toContain('**Errors in changed files:** 1 changed file threw errors')
    expect(html).toContain('1.2k errors thrown here')
    expect(html).toContain('>1.8k views<')

    const broken = join(tmp, 'broken.json')
    writeFileSync(broken, '{}')
    const failed = (await analyzeRepo(s.repo, { usage: broken })).output
    expect(failed.usage?.status).toBe('error')
    expect(renderReport(failed)).toContain('usage report not read')
  })

  it('formats counts compactly', () => {
    expect([999, 1234, 12_345, 2_500_000].map(compactNumber)).toEqual(['999', '1.2k', '12k', '2.5M'])
  })
})
