import { resolve } from 'node:path'
import { UsageError } from '../config/load.js'
import { DatadogClient } from '../datadog/client.js'
import { compareStrings } from '../output/order.js'
import { writeTextFile } from '../output/write.js'
import type { UsageFile, UsageIssue, UsageRow } from '../signals/usage.js'
import type { Context } from './context.js'
import { EXIT_OK, writeStdout } from './run.js'
import { mapLimit } from './concurrency.js'

/** Datadog requests in flight at once (well under the API rate limits). */
const DATADOG_CONCURRENCY = 6

export interface UsageOptions {
  out?: string
  days?: number
}

/** Rows merged by service and name (counts summed, issue ids united), sorted. */
function sorted(rows: readonly UsageRow[]): UsageRow[] {
  const merged = new Map<string, { name: string; count: number; issues: Set<string>; service?: string }>()
  for (const r of rows) {
    const id = `${r.service ?? ''}\n${r.name}`
    const prev = merged.get(id) ?? { name: r.name, count: 0, issues: new Set<string>(), ...(r.service === undefined ? {} : { service: r.service }) }
    prev.count += r.count
    for (const issue of r.issues ?? []) prev.issues.add(issue)
    merged.set(id, prev)
  }
  return [...merged.values()]
    .map(({ issues, ...r }) => ({ ...r, count: Math.round(r.count), ...(issues.size > 0 ? { issues: [...issues].sort(compareStrings) } : {}) }))
    .sort((a, b) => compareStrings(a.service ?? '', b.service ?? '') || compareStrings(a.name, b.name))
}

/**
 * Reads page views and RUM errors per page, requests and error spans per operation (APM trace metrics) and Error
 * Tracking issues from Datadog, and writes a usage report for `analyze --usage`. The only command besides `comment`
 * that uses the network; it never reads the analyzed code.
 */
export async function runUsage(ctx: Context, options: UsageOptions, env: NodeJS.ProcessEnv, now: Date, fetchImpl?: typeof fetch): Promise<UsageFile> {
  const dd = ctx.config.datadog
  if (dd === undefined) throw new UsageError('no "datadog" section in the configuration: set datadog.rum (pages) and/or datadog.apm (operations)')
  const apiKey = env.DD_API_KEY
  const appKey = env.DD_APP_KEY ?? env.DD_APPLICATION_KEY
  if (!apiKey || !appKey) throw new UsageError('DD_API_KEY and DD_APP_KEY must be set (an application key with the rum_apps_read, timeseries_query, apm_read and error_tracking_read scopes)')
  const days = options.days ?? dd.days
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const client = new DatadogClient({ site: dd.site, apiKey, appKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
  const envFilter = dd.env === undefined ? '' : ` env:${dd.env}`
  let pages: UsageRow[] = []
  let operations: UsageRow[] = []
  const issues: UsageIssue[] = []
  const callers: UsageFile['callers'] = []
  const after: (() => void)[] = []
  const sources: string[] = []
  // Every Datadog query is independent: they run a few at a time, and the rows are sorted afterwards.
  const tasks: (() => Promise<void>)[] = []
  if (dd.rum) {
    const app = `@application.id:${dd.rum.applicationId}${envFilter}`
    const facet = dd.rum.facet
    let views: UsageRow[] = []
    let errors: UsageRow[] = []
    tasks.push(async () => {
      views = await client.rumViews(`@type:view ${app}`, facet, from, now)
    })
    if (dd.errors) {
      tasks.push(async () => {
        errors = await client.rumIssues(`@type:error ${app}`, facet, from, now)
      })
      tasks.push(async () => {
        issues.push(...(await client.errorIssues(app, 'rum', from, now)))
      })
    }
    sources.push('Datadog RUM')
    after.push(() => {
      pages = sorted([...views, ...errors])
      ctx.log(`RUM: ${views.length} ${facet} value(s), ${errors.length} with errors`)
    })
  }
  if (dd.apm) {
    const services = typeof dd.apm.service === 'string' ? [dd.apm.service] : dd.apm.service
    const tag = (rows: UsageRow[], service: string): UsageRow[] => (services.length > 1 ? rows.map((r) => ({ ...r, service })) : rows)
    for (const service of services) {
      const scope = [`service:${service}`, ...(dd.env === undefined ? [] : [`env:${dd.env}`])].join(',')
      for (const operation of dd.apm.operations) {
        tasks.push(async () => {
          const hits = await client.metricByTag(`sum:trace.${operation}.hits{${scope}} by {resource_name}.as_count()`, 'resource_name', from, now)
          ctx.log(`APM ${service}: ${hits.length} resource(s) of trace.${operation}.hits`)
          operations.push(...tag(hits, service))
        })
      }
      if (dd.errors) {
        tasks.push(async () => {
          // Error spans of the service (any operation), with their Error Tracking issue: distinct errors per resource.
          // With several services, rows keep theirs: the same path in two apps goes to each app's keys.
          const errors = await client.spanIssues(`service:${service}${envFilter} status:error`, from, now)
          ctx.log(`APM ${service}: ${errors.length} resource(s) with errors`)
          operations.push(...tag(errors, service))
        })
        tasks.push(async () => {
          issues.push(...(await client.errorIssues(`service:${service}${envFilter}`, 'trace', from, now)))
        })
      }
      // Who calls this service: client spans of other services name it as their peer.service, with the URL path
      // called (client span resources hold only the method, so the indexed spans are read).
      tasks.push(async () => {
        for (const c of await client.spanCallers(service, from, now)) callers.push({ ...c, count: Math.round(c.count) })
      })
    }
    sources.push('Datadog APM')
    after.push(() => {
      operations = sorted(operations)
      ctx.log(`APM: ${new Set(callers.map((c) => c.service)).size} calling service(s)`)
    })
  }
  await mapLimit(tasks, DATADOG_CONCURRENCY, (task) => task())
  for (const join of after) join()
  if (dd.errors) ctx.log(`Error Tracking: ${issues.length} issue(s) with a file`)
  const sortedIssues = issues.sort((a, b) => compareStrings(a.file, b.file) || compareStrings(a.type, b.type) || b.count - a.count)
  const sortedCallers = callers.filter((c) => c.name !== '' && c.service !== '').sort((a, b) => compareStrings(a.service, b.service) || compareStrings(a.name, b.name))
  return { farolUsage: 1, site: dd.site, source: sources.join(' + '), from: from.toISOString(), to: now.toISOString(), pages, operations, callers: sortedCallers, issues: sortedIssues }
}

export async function usageCommand(ctx: Context, options: UsageOptions, env: NodeJS.ProcessEnv = process.env, now = new Date(), fetchImpl?: typeof fetch): Promise<number> {
  const text = `${JSON.stringify(await runUsage(ctx, options, env, now, fetchImpl), null, 2)}\n`
  if (options.out === undefined) await writeStdout(text)
  else writeTextFile(resolve(options.out), text)
  return EXIT_OK
}
