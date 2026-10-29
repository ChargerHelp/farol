import ts from 'typescript'
import { compareStrings, sortedUnique } from '../output/order.js'
import type { DynamicRoute } from '../routes/types.js'
import { literal, METHODS, mountId } from './rest.js'

/** App methods that return the app itself: a chained call stays on the same app. */
const SAME_APP = new Set([...METHODS, 'route', 'use', 'on', 'onError', 'notFound'])

/** A Hono app: a `new Hono()` expression or a parameter typed `Hono`. */
type App = ts.NewExpression | ts.ParameterDeclaration

/** `from` is mounted at `prefix` in `to`'s parent, or (no prefix) `to` is a parameter that receives `from`. */
interface Edge {
  from: App
  to: App
  prefix?: string
  /** `mountId` of a mount; argument edges have none (they are not diffed). */
  id?: string
}

export interface HonoApps {
  /**
   * Base paths of the app a handler registers on, one per mount path from a root app. `undefined`: the receiver is not
   * a Hono app (Express, Fastify: paths as written). `null`: the file uses Hono but farol cannot follow the receiver.
   * Mounts in `without` are left out (to list the endpoints a PR's new mounts add).
   */
  basesOf: (receiver: ts.Expression, without?: ReadonlySet<string>) => string[] | null | undefined
  /** Files with at least one mount: changing them can change endpoint paths. */
  mountFiles: Set<string>
  dynamic: DynamicRoute[]
}

export const UNRESOLVED_APP = 'Hono app is not one farol can follow (basePath, alias or property)'

/** `mergePath` of hono 4.13.13 (`dist/utils/url.js`) for two paths. */
export function mergePath(base: string, sub: string): string {
  return `${base.startsWith('/') ? '' : '/'}${base}${sub === '/' ? '' : `${base.endsWith('/') ? '' : '/'}${sub.startsWith('/') ? sub.slice(1) : sub}`}`
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x)) x = x.expression
  return x
}

const isHonoModule = (spec: string): boolean => spec === 'hono' || spec.startsWith('hono/')

function importsHono(sf: ts.SourceFile): boolean {
  return sf.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && isHonoModule(s.moduleSpecifier.text))
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

/**
 * The Hono apps of the program and how they are mounted (`app.route(prefix, sub)`), from the roots (apps nothing
 * mounts) down. Factories are followed through their single returned app; an app passed to a `Hono` parameter is that
 * parameter's app. What farol cannot follow in a file that uses Hono is a dynamic route, never a path as written.
 */
export function honoApps(files: readonly ts.SourceFile[], checker: ts.TypeChecker, rel: (fileName: string) => string): HonoApps {
  const honoFiles = new Set(files.filter(importsHono))
  const incoming = new Map<App, Edge[]>()
  const mountFiles = new Set<string>()
  const dynamic: DynamicRoute[] = []
  const at = (node: ts.Node, detail: string): void => {
    const sf = node.getSourceFile()
    dynamic.push({ file: rel(sf.fileName), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, detail })
  }

  const declOf = (id: ts.Identifier): ts.Declaration | undefined => {
    const symbol = checker.getSymbolAtLocation(id)
    const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return target?.valueDeclaration ?? target?.declarations?.[0]
  }
  /** `Hono` imported from hono (also `import type`, `{ Hono as H }`); read on the import, so it works without node_modules. */
  const isHonoName = (id: ts.Node): boolean => {
    if (!ts.isIdentifier(id)) return false
    const decl = checker.getSymbolAtLocation(id)?.declarations?.[0]
    if (!decl || !ts.isImportSpecifier(decl)) return false
    const spec = decl.parent.parent.parent.moduleSpecifier
    return ts.isStringLiteral(spec) && isHonoModule(spec.text) && (decl.propertyName ?? decl.name).text === 'Hono'
  }
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
  const addEdge = (edge: Edge): void => {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge])
  }

  // Functions with Hono parameters, by name, so only their calls are resolved.
  const honoParamNames = new Set<string>()
  const scanParams = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node.parameters.some(isHonoParam)) {
      const name = node.name ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined)
      if (name && ts.isIdentifier(name)) honoParamNames.add(name.text)
    }
    ts.forEachChild(node, scanParams)
  }
  for (const sf of honoFiles) scanParams(sf)

  const mount = (call: ts.CallExpression & { expression: ts.PropertyAccessExpression }): void => {
    const sf = call.getSourceFile()
    const parent = appOf(call.expression.expression)
    if (!parent) {
      if (honoFiles.has(sf)) at(call, UNRESOLVED_APP)
      return
    }
    const [prefixArg, targetArg] = call.arguments
    if (!prefixArg || !targetArg) return
    mountFiles.add(rel(sf.fileName))
    const prefix = literal(prefixArg)
    if (prefix === undefined) {
      at(prefixArg, 'Hono route() prefix is not a string literal')
      return
    }
    const target = unwrap(targetArg)
    const decl = ts.isIdentifier(target) ? declOf(target) : undefined
    if (decl && ts.isParameter(decl)) {
      at(target, 'Hono route() target is a parameter: its apps come from the callers')
      return
    }
    const child = appOf(target)
    if (!child) {
      at(target, 'Hono route() target is not an app farol can follow')
      return
    }
    addEdge({ from: parent, to: child, prefix, id: mountId(rel(sf.fileName), call) })
  }
  const argumentEdges = (call: ts.CallExpression): void => {
    const callee = unwrap(call.expression)
    if (!ts.isIdentifier(callee) || !honoParamNames.has(callee.text)) return
    const fn = functionOf(callee)
    fn?.parameters.forEach((p, i) => {
      const arg = call.arguments[i]
      if (!arg || !isHonoParam(p)) return
      const from = appOf(arg)
      if (!from) {
        at(arg, 'Hono app passed to a function is not one farol can follow')
        return
      }
      if (from !== p) addEdge({ from, to: p })
    })
  }
  for (const sf of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'route' && node.arguments.length === 2) mount(node as ts.CallExpression & { expression: ts.PropertyAccessExpression })
        else argumentEdges(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  // Roots (no incoming edge in the head) have '/'; a mount left out removes its paths, it does not make a root.
  const bases = (app: App, without: ReadonlySet<string> | undefined, stack: readonly App[]): string[] => {
    const edges = incoming.get(app)
    if (!edges) return ['/']
    const path = [...stack, app]
    return sortedUnique(edges.filter((e) => !(e.id !== undefined && without?.has(e.id)) && !path.includes(e.from)).flatMap((e) => bases(e.from, without, path).map((b) => (e.prefix === undefined ? b : mergePath(b, e.prefix)))))
  }
  return {
    basesOf: (receiver, without) => {
      const app = appOf(receiver)
      if (app) return bases(app, without, [])
      return honoFiles.has(receiver.getSourceFile()) ? null : undefined
    },
    mountFiles,
    dynamic: dynamic.sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.detail, b.detail)),
  }
}
