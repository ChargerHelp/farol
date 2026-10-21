import { posix } from 'node:path'
import type { DynamicRoute, RouteAdapter, RouteAdapterInput, RouteEntry, RouteTable } from '../types.js'
import { routeModulePath, routeTable, urlPath } from '../files.js'

/** `[id]` → `:id`, `[...slug]` and `[[...slug]]` → `*`. */
function urlSegment(segment: string): string {
  if (segment.startsWith('[[...') || segment.startsWith('[...')) return '*'
  if (segment.startsWith('[') && segment.endsWith(']')) return `:${segment.slice(1, -1)}`
  return segment
}

function has(files: readonly string[], dir: string): boolean {
  return files.some((f) => f.startsWith(`${dir}/`))
}

/** The directory holding `pages/` and `app/`: the configured one, or its `src/` when only that has them. */
function rootDir(input: RouteAdapterInput): string {
  const at = (d: string): string => (input.file === '' ? d : `${input.file}/${d}`)
  if (!has(input.files, at('pages')) && !has(input.files, at('app')) && (has(input.files, at('src/pages')) || has(input.files, at('src/app')))) return at('src')
  return input.file
}

/** Module of `name` (any route extension) directly in `dir`, or null. */
function moduleIn(files: ReadonlySet<string>, dir: string, name: string): string | null {
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    const f = dir === '' ? `${name}${ext}` : `${dir}/${name}${ext}`
    if (files.has(f)) return f
  }
  return null
}

/**
 * Pages Router: every module under `pages/` is a route (`index` is its directory's path); `_app` and `_document`
 * render every page, `pages/api/**` are API routes. Middleware (`middleware`, `proxy`) runs before every route.
 */
function pagesRoutes(root: string, files: readonly string[], fileSet: ReadonlySet<string>, middleware: string[]): RouteEntry[] {
  const dir = root === '' ? 'pages' : `${root}/pages`
  const app = moduleIn(fileSet, dir, '_app')
  const document = moduleIn(fileSet, dir, '_document')
  const routes: RouteEntry[] = []
  for (const file of files) {
    const rel = routeModulePath(dir, file)
    if (rel === null || rel === '_app' || rel === '_document') continue
    const parts = rel.split('/')
    const index = parts[parts.length - 1] === 'index'
    const path = urlPath((index ? parts.slice(0, -1) : parts).map(urlSegment))
    const api = parts[0] === 'api'
    const layouts = [...middleware, ...(api ? [] : [document, app].filter((m): m is string => m !== null))]
    routes.push({ key: path, path, index, entry: file, modules: [file], layouts })
  }
  return routes
}

/** App Router folder segments that are not part of the URL: route groups and parallel-route slots. */
function isHiddenSegment(segment: string): boolean {
  return (segment.startsWith('(') && segment.endsWith(')')) || segment.startsWith('@')
}

/** Private folders (`_x`) and intercepting routes (`(.)x`, `(..)x`, `(...)x`) are not routes of their own. */
function isSkippedSegment(segment: string): boolean {
  return segment.startsWith('_') || segment.startsWith('(.')
}

const APP_LAYOUTS = ['layout', 'template']
const APP_BOUNDARIES = ['loading', 'error', 'not-found', 'forbidden', 'unauthorized']

/**
 * App Router: each `page` is a page and each `route` an API route; the `layout` and `template` of every folder above
 * render it, and the `loading`, `error` and `not-found` boundaries above it are part of it.
 */
function appRoutes(root: string, files: readonly string[], fileSet: ReadonlySet<string>, middleware: string[]): RouteEntry[] {
  const dir = root === '' ? 'app' : `${root}/app`
  const routes: RouteEntry[] = []
  for (const file of files) {
    const rel = routeModulePath(dir, file)
    if (rel === null) continue
    const parts = rel.split('/')
    const name = parts.pop() ?? ''
    if ((name !== 'page' && name !== 'route') || parts.some(isSkippedSegment)) continue
    const layouts = [...middleware]
    const boundaries: string[] = []
    for (let i = 0; i <= parts.length; i++) {
      const folder = [dir, ...parts.slice(0, i)].join('/')
      for (const n of APP_LAYOUTS) {
        const m = moduleIn(fileSet, folder, n)
        if (m !== null) layouts.push(m)
      }
      for (const n of APP_BOUNDARIES) {
        const m = moduleIn(fileSet, folder, n)
        if (m !== null) boundaries.push(m)
      }
    }
    const path = urlPath(parts.filter((p) => !isHiddenSegment(p)).map(urlSegment))
    // Groups and slots can give two folders the same URL: the folder path keeps the key unique.
    const key = `/${parts.join('/')}`
    routes.push({ key, path, index: true, entry: file, modules: [file, ...boundaries].sort(), layouts: name === 'route' ? [...middleware] : layouts })
  }
  return routes
}

function extract(input: RouteAdapterInput): RouteTable {
  const root = rootDir(input)
  const fileSet = new Set(input.files)
  const middleware = ['middleware', 'proxy'].map((n) => moduleIn(fileSet, root, n)).filter((m): m is string => m !== null)
  const routes = [...pagesRoutes(root, input.files, fileSet, middleware), ...appRoutes(root, input.files, fileSet, middleware)]
  const dynamic: DynamicRoute[] = []
  if (routes.length === 0) dynamic.push({ file: root === '' ? '.' : root, line: 1, detail: `no Next.js route found: expected modules under ${posix.join(root, 'pages')} or page/route modules under ${posix.join(root, 'app')}` })
  return routeTable(routes, dynamic, routes.flatMap((r) => [...(r.entry === null ? [] : [r.entry]), ...r.modules, ...r.layouts]))
}

export const nextAdapter: RouteAdapter = { name: 'next', source: 'directory', extract }
