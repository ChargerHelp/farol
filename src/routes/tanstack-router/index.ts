import ts from 'typescript'
import { compareStrings } from '../../output/order.js'
import { parseIsolated } from '../../project/parse.js'
import type { DynamicRoute, RouteAdapter, RouteAdapterInput, RouteEntry, RouteTable } from '../types.js'
import { routeModulePath, routeTable, urlPath } from '../files.js'

const FILE_ROUTE_FACTORIES = new Set(['createFileRoute', 'createLazyFileRoute'])
const ROOT_ROUTE_FACTORIES = new Set(['createRootRoute', 'createRootRouteWithContext'])
const ROOT_ID = '__root__'

interface Found {
  /** Route id (`/_app/posts/$id/`), or ROOT_ID. */
  id: string
  lazy: boolean
}

/** `createFileRoute('/x')`, `createRootRoute(…)` or `createRootRouteWithContext<…>()(…)`: the callee name. */
function calleeName(call: ts.CallExpression): string | undefined {
  let callee: ts.Expression = call.expression
  // createRootRouteWithContext<T>()({…}): the inner call names the factory.
  while (ts.isCallExpression(callee)) callee = callee.expression
  return ts.isIdentifier(callee) ? callee.text : undefined
}

/** Route ids declared by a module, from its factory calls; non-literal ids are reported. */
function routesOf(file: string, code: string, dynamic: DynamicRoute[]): Found[] {
  const { sourceFile: sf } = parseIsolated(file, code)
  const found: Found[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      if (name !== undefined && ROOT_ROUTE_FACTORIES.has(name)) {
        if (!found.some((f) => f.id === ROOT_ID)) found.push({ id: ROOT_ID, lazy: false })
      } else if (name !== undefined && FILE_ROUTE_FACTORIES.has(name) && ts.isIdentifier(node.expression)) {
        const arg = node.arguments[0]
        if (arg !== undefined && ts.isStringLiteralLike(arg)) found.push({ id: arg.text, lazy: name === 'createLazyFileRoute' })
        else dynamic.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, detail: `${name} without a literal route id` })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** URL segment of a route id segment: pathless (`_layout`) and group (`(g)`) segments vanish, `$id` → `:id`, `$` → `*`. */
function urlSegment(segment: string): string {
  if (segment.startsWith('_') || (segment.startsWith('(') && segment.endsWith(')'))) return ''
  // `posts_` (un-nested) is `posts`; `[.]` escapes a character.
  let s = segment.endsWith('_') ? segment.slice(0, -1) : segment
  s = s.replaceAll('[', '').replaceAll(']', '')
  if (s === '$') return '*'
  // Optional parameters `{-$id}` and parameters with a prefix or suffix `{$id}.json` read as plain parameters.
  if (s.startsWith('{') && s.includes('$')) return `:${s.slice(s.indexOf('$') + 1, s.indexOf('}'))}`
  return s.startsWith('$') ? `:${s.slice(1)}` : s
}

/** Ids of the routes above a route, from the root down (only the ones that exist are layouts). */
function ancestorIds(id: string): string[] {
  const parts = id.split('/').filter((p) => p !== '')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(`/${parts.slice(0, i).join('/')}`)
  // An index route (`/posts/`) renders inside its parent (`/posts`).
  if (id.endsWith('/') && parts.length > 0) out.push(`/${parts.join('/')}`)
  return out
}

/**
 * TanStack Router file-based routing: every module under the routes directory that calls `createFileRoute('<id>')`
 * (or `createLazyFileRoute`) is a route, `createRootRoute` the root. A route with child routes is a layout of its
 * children; the others are the pages. Files and folders starting with `-` are ignored, as the router does.
 */
function extract(input: RouteAdapterInput): RouteTable {
  const dynamic: DynamicRoute[] = []
  const filesOf = new Map<string, { main: string[]; lazy: string[] }>()
  const sources: string[] = []
  for (const file of input.files) {
    const rel = routeModulePath(input.file, file)
    if (rel === null || rel.split('/').some((p) => p.startsWith('-'))) continue
    const code = input.read(file)
    if (code === undefined) throw new Error(`internal: ${file} is listed but cannot be read`)
    for (const f of routesOf(file, code, dynamic)) {
      const entry = filesOf.get(f.id) ?? { main: [], lazy: [] }
      ;(f.lazy ? entry.lazy : entry.main).push(file)
      filesOf.set(f.id, entry)
      sources.push(file)
    }
  }
  const moduleOf = (id: string): string | null => {
    const e = filesOf.get(id)
    return e === undefined ? null : ([...e.lazy, ...e.main].sort(compareStrings)[0] ?? null)
  }
  const root = moduleOf(ROOT_ID)
  const ids = [...filesOf.keys()].filter((id) => id !== ROOT_ID)
  const parents = new Set(ids.flatMap(ancestorIds))
  const routes: RouteEntry[] = []
  for (const id of ids) {
    // A route that others render inside is their layout; it is listed only through them.
    if (parents.has(id) && !id.endsWith('/')) continue
    const own = filesOf.get(id) ?? { main: [], lazy: [] }
    const modules = [...own.main, ...own.lazy].sort(compareStrings)
    const layouts = [...(root === null ? [] : [root]), ...ancestorIds(id).flatMap((a) => { const m = moduleOf(a); return m === null ? [] : [m] })]
    routes.push({ key: id, path: urlPath(id.split('/').map(urlSegment)), index: id.endsWith('/'), entry: moduleOf(id), modules, layouts })
  }
  if (routes.length === 0) dynamic.push({ file: input.file, line: 1, detail: 'no TanStack Router route found: expected modules calling createFileRoute(\'<id>\') under the routes directory' })
  return routeTable(routes, dynamic, sources)
}

export const tanstackRouterAdapter: RouteAdapter = { name: 'tanstack-router', source: 'directory', extract }
