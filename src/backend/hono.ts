import ts from 'typescript'
import { sortedUnique } from '../output/order.js'
import { unwrap } from '../project/parse.js'
import type { DynamicRoute } from '../routes/types.js'
import { mergePath } from './hono-paths.js'
import { literal, METHODS, plainChain, plainTarget } from './rest.js'

/** App methods that return the app itself: a chained call stays on the same app. */
const SAME_APP = new Set([...METHODS, 'route', 'use', 'on', 'onError', 'notFound'])

/** A Hono app: a `new Hono()` expression or a parameter typed `Hono`. */
type App = ts.NewExpression | ts.ParameterDeclaration

/** `to` is mounted in `from` (`mount`: its prefix and `MountNode` id), or `to` is a parameter that receives `from`. */
type Edge = { from: App; to: App } & ({ mount: { prefix: string; id: string } } | { mount?: undefined })

/** Code a call installs on an app: `use()`, `on()`, `onError()` or a handler that can call `next`. */
export interface Registration {
  /** The full paths it runs under: its path (`*` when farol cannot read it) under every base path of its app. */
  paths: string[]
  args: ts.Expression[]
}

export interface HonoApps {
  /**
   * Base paths of the app a handler registers on, one per mount path from a root app. `undefined`: the receiver is not
   * a Hono app (Express, Fastify: paths as written). `null`: the file uses Hono but farol cannot follow the receiver.
   * Mounts in `without` are left out (to list the endpoints a PR's new mounts add).
   */
  basesOf: (receiver: ts.Expression, without?: ReadonlySet<string>) => string[] | null | undefined
  /** Files that use Hono (import or re-export it, or mount an app): their mounts are compared. */
  honoFiles: Set<string>
  /** Files with at least one mount: changing them can change endpoint paths. */
  mountFiles: Set<string>
  /** Full paths a mount (`MountNode` id) serves: its sub-app's routes and middleware run under them. Empty: unknown. */
  mountBases: (id: string) => string[]
  /**
   * Whether the sub-app of a mount, or an app mounted or passed under it, registers middleware: `use()`, a handler that
   * takes `next`, or `on()` (whose paths farol does not read).
   */
  mountMiddleware: (id: string) => boolean
  /** Base paths of a handler's receiver that go through a mount (`MountNode` id). */
  basesThrough: (receiver: ts.Expression, id: string) => string[]
  registrations: Registration[]
  /** Base paths of the apps a file creates, receives or registers on; empty when it has none. */
  fileBases: (file: string) => string[]
  dynamic: DynamicRoute[]
}

export const UNRESOLVED_APP = 'Hono app is not one farol can follow (basePath, alias or property)'

export const isHonoModule = (spec: string): boolean => spec === 'hono' || spec.startsWith('hono/') || spec.startsWith('@hono/')

/** Whether a file imports or re-exports from a hono package (syntax only). */
export function importsHono(sf: ts.SourceFile): boolean {
  return sf.statements.some((s) => (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier !== undefined && ts.isStringLiteral(s.moduleSpecifier) && isHonoModule(s.moduleSpecifier.text))
}

/** Whether a file version holds a Hono app: `new Hono()`, a parameter typed `Hono`, or a `use`, `onError` or `on` call (syntax only). */
export function holdsApp(sf: ts.SourceFile): boolean {
  const names = new Set<string>()
  for (const s of sf.statements) {
    const named = ts.isImportDeclaration(s) ? s.importClause?.namedBindings : undefined
    if (named && ts.isNamedImports(named)) for (const el of named.elements) if ((el.propertyName ?? el.name).text === 'Hono') names.add(el.name.text)
  }
  const isHono = (e: ts.Node | undefined): boolean => e !== undefined && ts.isIdentifier(e) && names.has(e.text)
  const found = (node: ts.Node): boolean => {
    if (ts.isNewExpression(node) && isHono(node.expression)) return true
    if (ts.isParameter(node) && node.type && ts.isTypeReferenceNode(node.type) && isHono(node.type.typeName)) return true
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text
      if (name === 'use' || name === 'onError' || (name === 'on' && node.arguments.length >= 3)) return true
    }
    return ts.forEachChild(node, (child) => (found(child) ? true : undefined)) ?? false
  }
  return found(sf)
}

type MountCall = ts.CallExpression & { expression: ts.PropertyAccessExpression }

const isRouteCall = (n: ts.Node): n is MountCall => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'route'

/** A Hono mount (`app.route('/prefix', sub)`, two arguments, none spread). */
export interface MountNode {
  /** The statement (or the call inside a chain), blanked out of the module code when files are compared. */
  node: ts.Node
  call: MountCall
  /** Identity across the base and head versions of the file: file, normalized text and, for repeated texts, the occurrence. */
  id: string
  prefixArg: ts.Expression
  target: ts.Expression
  /** The prefix as written. */
  prefix: string
  /** Adding the mount runs no other code (receiver and target are names or factory calls with static arguments). */
  plain: boolean
}

export function mountNodes(sf: ts.SourceFile, file: string): MountNode[] {
  const out: MountNode[] = []
  const seen = new Map<string, number>()
  const visit = (node: ts.Node): void => {
    const [prefixArg, target] = isRouteCall(node) ? node.arguments : []
    if (isRouteCall(node) && node.arguments.length === 2 && prefixArg && target && !ts.isSpreadElement(prefixArg) && !ts.isSpreadElement(target)) {
      const text = `${file} ${node.getText(sf).replace(/\s+/g, ' ').trim()}`
      const n = (seen.get(text) ?? 0) + 1
      seen.set(text, n)
      const plain = plainChain(node.expression.expression) && plainTarget(target)
      out.push({ node: ts.isExpressionStatement(node.parent) ? node.parent : node, call: node, id: n === 1 ? text : `${text} #${n}`, prefixArg, target, prefix: prefixArg.getText(sf), plain })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Expression returned by a function: every `return` of its own body (nested functions skipped), or an arrow's body. */
function returnsOf(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return []
  if (!ts.isBlock(fn.body)) return [fn.body]
  const out: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) {
      if (node.expression) out.push(node.expression)
      return
    }
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return out
}

/** Resolution of expressions to Hono apps with the type checker (works without node_modules: names are read on imports). */
function appResolver(checker: ts.TypeChecker) {
  const declOf = (id: ts.Identifier): ts.Declaration | undefined => {
    const symbol = checker.getSymbolAtLocation(id)
    const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return target?.valueDeclaration ?? target?.declarations?.[0]
  }
  /** `Hono` of a hono package, also through project re-exports (`export { Hono } from 'hono'`), `import type` and `as`. */
  const isHonoName = (id: ts.Node): boolean => {
    let symbol = ts.isIdentifier(id) ? checker.getSymbolAtLocation(id) : undefined
    for (let depth = 0; symbol && depth < 10; depth++) {
      const decl = symbol.declarations?.[0]
      if (!decl || !(ts.isImportSpecifier(decl) || ts.isExportSpecifier(decl))) return false
      const spec = ts.isImportSpecifier(decl) ? decl.parent.parent.parent.moduleSpecifier : decl.parent.parent.moduleSpecifier
      if (spec && ts.isStringLiteral(spec) && isHonoModule(spec.text)) return (decl.propertyName ?? decl.name).text === 'Hono'
      symbol = checker.getImmediateAliasedSymbol(symbol)
    }
    return false
  }
  /** A file that imports from hono, or from a project module that re-exports it. */
  const usesHono = (sf: ts.SourceFile): boolean =>
    importsHono(sf) ||
    sf.statements.some((s) => {
      const module = ts.isImportDeclaration(s) ? checker.getSymbolAtLocation(s.moduleSpecifier)?.valueDeclaration : undefined
      return module !== undefined && ts.isSourceFile(module) && importsHono(module)
    })
  const isHonoParam = (p: ts.ParameterDeclaration): boolean => p.type !== undefined && ts.isTypeReferenceNode(p.type) && isHonoName(p.type.typeName)
  const functionOf = (callee: ts.Expression): ts.FunctionLikeDeclaration | undefined => {
    const e = unwrap(callee)
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e
    const d = ts.isIdentifier(e) ? declOf(e) : undefined
    if (!d || d.getSourceFile().isDeclarationFile) return undefined
    if (ts.isFunctionDeclaration(d)) return d
    const init = ts.isVariableDeclaration(d) && d.initializer ? unwrap(d.initializer) : undefined
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined
  }
  const appOf = (expr: ts.Expression, seen = new Set<ts.Node>()): App | undefined => {
    const e = unwrap(expr)
    if (seen.has(e)) return undefined
    seen.add(e)
    if (ts.isNewExpression(e)) return isHonoName(e.expression) ? e : undefined
    if (ts.isIdentifier(e)) {
      const d = declOf(e)
      if (d && ts.isParameter(d)) return isHonoParam(d) ? d : undefined
      if (d && ts.isVariableDeclaration(d) && d.initializer) return appOf(d.initializer, seen)
      return d && ts.isExportAssignment(d) ? appOf(d.expression, seen) : undefined
    }
    if (!ts.isCallExpression(e)) return undefined
    if (ts.isPropertyAccessExpression(e.expression) && SAME_APP.has(e.expression.name.text)) {
      const app = appOf(e.expression.expression, seen)
      if (app) return app
    }
    const fn = functionOf(e.expression)
    const apps = fn ? returnsOf(fn).map((r) => appOf(r, new Set(seen))) : []
    return apps.length > 0 && apps.every((a) => a !== undefined && a === apps[0]) ? apps[0] : undefined
  }
  return { declOf, usesHono, isHonoParam, functionOf, appOf }
}

/**
 * The mount edges (`app.route(prefix, sub)`) and argument edges (an app passed to a `Hono` parameter) of the program.
 * What farol cannot follow in a file that uses Hono, or in a mount whose target is a Hono app, is a dynamic route.
 */
function collectEdges(files: readonly ts.SourceFile[], honoFiles: ReadonlySet<ts.SourceFile>, r: ReturnType<typeof appResolver>, rel: (fileName: string) => string) {
  const incoming = new Map<App, Edge[]>()
  const mountFiles = new Set<string>()
  const middleware = new Set<App>()
  const registered: { app: App; path: string; args: ts.Expression[] }[] = []
  const fileApps = new Map<string, Set<App>>()
  const holds = (node: ts.Node, app: App): void => {
    const file = rel(node.getSourceFile().fileName)
    fileApps.set(file, (fileApps.get(file) ?? new Set<App>()).add(app))
  }
  const dynamic: DynamicRoute[] = []
  const at = (node: ts.Node, detail: string): void => {
    const sf = node.getSourceFile()
    dynamic.push({ file: rel(sf.fileName), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, detail })
  }
  const addEdge = (edge: Edge): void => {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge])
  }

  // Functions with Hono parameters, by name, so only their calls are resolved.
  const honoParamNames = new Set<string>()
  const scanParams = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node.parameters.some(r.isHonoParam)) {
      const name = node.name ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined)
      if (name && ts.isIdentifier(name)) honoParamNames.add(name.text)
    }
    ts.forEachChild(node, scanParams)
  }
  for (const sf of honoFiles) scanParams(sf)

  const mount = (m: MountNode): void => {
    const sf = m.call.getSourceFile()
    const parent = r.appOf(m.call.expression.expression)
    if (!parent) {
      // A Hono app as the target proves a Hono mount, also in a file without a hono import.
      if (honoFiles.has(sf) || r.appOf(m.target) !== undefined) at(m.call, UNRESOLVED_APP)
      return
    }
    mountFiles.add(rel(sf.fileName))
    holds(m.call, parent)
    const prefix = literal(m.prefixArg)
    if (prefix === undefined) {
      at(m.prefixArg, 'Hono route() prefix is not a string literal')
      return
    }
    const target = unwrap(m.target)
    const decl = ts.isIdentifier(target) ? r.declOf(target) : undefined
    if (decl && ts.isParameter(decl)) {
      at(target, 'Hono route() target is a parameter: its apps come from the callers')
      return
    }
    const child = r.appOf(target)
    if (!child) {
      at(target, 'Hono route() target is not an app farol can follow')
      return
    }
    addEdge({ from: parent, to: child, mount: { prefix, id: m.id } })
  }
  const argumentEdges = (call: ts.CallExpression): void => {
    const callee = unwrap(call.expression)
    if (!ts.isIdentifier(callee) || !honoParamNames.has(callee.text)) return
    r.functionOf(callee)?.parameters.forEach((p, i) => {
      const arg = call.arguments[i]
      if (!arg || !r.isHonoParam(p)) return
      const from = r.appOf(arg)
      if (!from) {
        at(arg, 'Hono app passed to a function is not one farol can follow')
        return
      }
      if (from !== p) addEdge({ from, to: p })
    })
  }
  // Middleware runs for every route under its app's paths, so the apps that register some are recorded.
  const takesNext = (a: ts.Expression): boolean => {
    const x = unwrap(a)
    return (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) && x.parameters.length >= 2
  }
  // A named handler on `all` or a `*` path is middleware when its function takes `next`, or when farol cannot find it.
  const namedNext = (call: MountCall): boolean => {
    const last = call.arguments[call.arguments.length - 1]
    const wide = call.expression.name.text === 'all' || (literal(call.arguments[0]) ?? '*').includes('*')
    const fn = last && !takesNext(last) ? r.functionOf(last) : undefined
    return last !== undefined && wide && !ts.isArrowFunction(unwrap(last)) && !ts.isFunctionExpression(unwrap(last)) && (fn ? fn.parameters.length >= 2 : true)
  }
  // Path and code of a call that installs code on its app; a path farol cannot read covers the whole app.
  const registrationOf = (call: MountCall): { path: string; args: ts.Expression[] } | undefined => {
    const name = call.expression.name.text
    const [first, second] = call.arguments
    if (name === 'onError') return call.arguments.length === 1 ? { path: '*', args: [...call.arguments] } : undefined
    // Hono's `on(method, path, ...handlers)` has three arguments or more (`process.on(event, fn)` has two).
    if (name === 'on') return call.arguments.length >= 3 ? { path: literal(second) ?? '*', args: call.arguments.slice(2) } : undefined
    if (name !== 'use' && !(METHODS.has(name) && (call.arguments.some(takesNext) || namedNext(call)))) return undefined
    const path = literal(first)
    return { path: path ?? '*', args: path === undefined ? [...call.arguments] : call.arguments.slice(1) }
  }
  const isParameterName = (a: ts.Expression): boolean => {
    const x = unwrap(a)
    const decl = ts.isIdentifier(x) ? r.declOf(x) : undefined
    return decl !== undefined && ts.isParameter(decl)
  }
  const middlewareCall = (call: MountCall): void => {
    const name = call.expression.name.text
    const registration = registrationOf(call)
    const guards = METHODS.has(name) ? call.arguments.slice(1, -1) : []
    if (!registration && guards.length === 0) return
    const app = r.appOf(call.expression.expression)
    if (!app) {
      // A handler on an app farol cannot follow is already a dynamic route (`buildBackendTable`).
      if (registration && !METHODS.has(name) && honoFiles.has(call.getSourceFile())) at(call, `Hono ${name}() is on an app farol cannot follow: its middleware cannot be placed`)
      return
    }
    for (const a of new Set([...(registration?.args ?? []), ...guards])) if (isParameterName(a)) at(a, 'Hono middleware is a parameter: its code comes from the callers')
    if (!registration) return
    // `onError` runs only when a handler throws: a new mount with one adds no code to other endpoints' requests.
    if (name !== 'onError') middleware.add(app)
    holds(call, app)
    registered.push({ app, ...registration })
  }
  for (const sf of files) {
    for (const m of mountNodes(sf, rel(sf.fileName))) mount(m)
    const visit = (node: ts.Node): void => {
      if (honoFiles.has(sf) && ts.isNewExpression(node)) {
        const app = r.appOf(node)
        if (app) holds(node, app)
      }
      if (honoFiles.has(sf) && ts.isParameter(node) && r.isHonoParam(node)) holds(node, node)
      if (ts.isCallExpression(node)) argumentEdges(node)
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) middlewareCall(node as MountCall)
      if (isRouteCall(node) && node.arguments.some(ts.isSpreadElement) && honoFiles.has(sf)) at(node, 'Hono route() arguments are spread')
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { incoming, mountFiles, middleware, registered, fileApps, dynamic }
}

/**
 * The Hono apps of the program and how they are mounted, from the roots (apps nothing mounts) down. Factories are
 * followed through their single returned app; an app passed to a `Hono` parameter is that parameter's app.
 */
export function honoApps(files: readonly ts.SourceFile[], checker: ts.TypeChecker, rel: (fileName: string) => string): HonoApps {
  const r = appResolver(checker)
  const honoFiles = new Set(files.filter(r.usesHono))
  const { incoming, mountFiles, middleware, registered, fileApps, dynamic } = collectEdges(files, honoFiles, r, rel)
  const edges = [...incoming.values()].flat()
  const outgoing = new Map<App, Edge[]>()
  for (const e of edges) outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e])
  const hasMiddleware = (app: App, seen: Set<App>): boolean => {
    if (seen.has(app)) return false
    seen.add(app)
    return middleware.has(app) || (outgoing.get(app) ?? []).some((e) => hasMiddleware(e.to, seen))
  }
  // Roots (no incoming edge in the head) have '/'; a mount left out removes its paths, it does not make a root.
  const bases = (app: App, without: ReadonlySet<string> | undefined, stack: readonly App[]): string[] => {
    const edges = incoming.get(app)
    if (!edges) return ['/']
    const path = [...stack, app]
    const kept = edges.filter((e) => !(e.mount && without?.has(e.mount.id)) && !path.includes(e.from))
    return sortedUnique(kept.flatMap((e) => bases(e.from, without, path).map((b) => (e.mount ? mergePath(b, e.mount.prefix) : b))))
  }
  // Base paths of `app` whose path from a root goes through the mount `id`.
  const through = (app: App, id: string, stack: readonly App[]): string[] => {
    const path = [...stack, app]
    return sortedUnique(
      (incoming.get(app) ?? [])
        .filter((e) => !path.includes(e.from))
        .flatMap((e) => (e.mount?.id === id ? bases(e.from, undefined, path) : through(e.from, id, path)).map((b) => (e.mount ? mergePath(b, e.mount.prefix) : b))),
    )
  }
  return {
    basesOf: (receiver, without) => {
      const app = r.appOf(receiver)
      if (app) return bases(app, without, [])
      return honoFiles.has(receiver.getSourceFile()) ? null : undefined
    },
    honoFiles: new Set([...[...honoFiles].map((sf) => rel(sf.fileName)), ...mountFiles]),
    mountFiles,
    mountBases: (id) =>
      sortedUnique(
        edges.flatMap((e) => {
          const prefix = e.mount?.id === id ? e.mount.prefix : undefined
          return prefix === undefined ? [] : bases(e.from, undefined, []).map((b) => mergePath(b, prefix))
        }),
      ),
    mountMiddleware: (id) => edges.some((e) => e.mount?.id === id && hasMiddleware(e.to, new Set())),
    basesThrough: (receiver, id) => {
      const app = r.appOf(receiver)
      return app ? through(app, id, []) : []
    },
    registrations: registered.map((x) => ({ paths: bases(x.app, undefined, []).map((b) => mergePath(b, x.path)), args: x.args })),
    fileBases: (file) => sortedUnique([...(fileApps.get(file) ?? [])].flatMap((app) => bases(app, undefined, []))),
    dynamic,
  }
}
