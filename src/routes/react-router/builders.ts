import ts from 'typescript'
import { sortedUnique } from '../../output/order.js'
import { joinRoutePath, KEY_SEPARATOR, routeSegment } from '../paths.js'
import type { RouteEntry } from '../types.js'
import { elementModules } from './elements.js'
import { propertyName, unwrap, type Modules, type Scope } from './scope.js'

export interface Ctx {
  segments: string[]
  path: string
  layouts: string[]
}

export const ROOT_CTX: Ctx = { segments: [], path: '', layouts: [] }

interface RouteDef {
  path: string | undefined
  index: boolean
  entry: string | null
  modules: string[]
}

export const ROUTE_KEYS = new Set(['path', 'index', 'element', 'Component', 'lazy', 'children'])

/** Collects the route definition fields shared by the object and JSX forms. Returns null when any field is unsupported. */
class DefBuilder {
  path: string | undefined
  index = false
  private readonly primary: (string | null)[] = []
  private readonly modules: string[] = []
  ok = true

  constructor(private readonly scope: Scope) {}

  /** Records an unsupported construct and invalidates this route. */
  reject(node: ts.Node, detail: string): void {
    this.scope.fail(node, detail)
    this.ok = false
  }

  private take(m: Modules | null, primary: boolean): void {
    if (m === null) {
      this.ok = false
      return
    }
    if (primary) this.primary.push(m.entry)
    this.modules.push(...m.modules)
  }

  set(name: string, value: ts.Node, node: ts.Node): void {
    const s = this.scope
    const expr = ts.isExpression(value) ? value : undefined
    switch (name) {
      case 'path': {
        const p = expr ? s.stringValue(expr) : undefined
        if (p === undefined) this.reject(node, `computed route path "${value.getText(s.sf)}"`)
        else this.path = p
        return
      }
      case 'index': {
        const e = expr ? unwrap(expr) : undefined
        if (e?.kind === ts.SyntaxKind.TrueKeyword) this.index = true
        else if (e?.kind !== ts.SyntaxKind.FalseKeyword) this.reject(node, `computed index flag "${value.getText(s.sf)}"`)
        return
      }
      case 'element':
      case 'errorElement':
      case 'hydrateFallbackElement':
        if (!expr) this.reject(node, `unsupported ${name}`)
        else this.take(elementModules(s, expr), name === 'element')
        return
      case 'Component':
      case 'ErrorBoundary':
      case 'HydrateFallback':
        if (!expr) this.reject(node, `unsupported ${name}`)
        else this.take(s.componentValue(expr), name === 'Component')
        return
      case 'lazy':
        this.take(s.lazyValue(value), true)
        return
      default:
        return
    }
  }

  build(): RouteDef | null {
    if (!this.ok) return null
    return { path: this.path, index: this.index, entry: this.primary.find((e) => e !== null) ?? null, modules: sortedUnique(this.modules) }
  }
}

export class RouteCollector {
  readonly routes: RouteEntry[] = []

  private emit(def: RouteDef, ctx: Ctx, children: ((child: Ctx) => void) | undefined): void {
    const segment = routeSegment(def)
    const path = def.path !== undefined ? joinRoutePath(ctx.path, def.path) : ctx.path === '' ? '/' : ctx.path
    const segments = [...ctx.segments, segment]
    this.routes.push({ key: segments.join(KEY_SEPARATOR), path, index: def.index, entry: def.entry, modules: def.modules, layouts: ctx.layouts })
    const childCtx: Ctx = { segments, path: def.path !== undefined ? path : ctx.path, layouts: def.entry === null ? ctx.layouts : [...ctx.layouts, def.entry] }
    children?.(childCtx)
  }

  /** Routes from an expression: array literal, constant (here or imported), or createRoutesFromElements(). */
  fromExpression(s: Scope, expr: ts.Expression, ctx: Ctx, depth = 0): void {
    const e = unwrap(expr)
    if (depth > 20) {
      s.fail(e, 'route definitions nest too deeply (circular constants?)')
      return
    }
    if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) {
        if (ts.isSpreadElement(el)) {
          const spread = unwrap(el.expression)
          if (ts.isIdentifier(spread)) this.fromExpression(s, spread, ctx, depth + 1)
          else s.fail(el, `spread in route array "${el.getText(s.sf)}"`)
        } else if (ts.isObjectLiteralExpression(unwrap(el))) this.fromObject(s, unwrap(el) as ts.ObjectLiteralExpression, ctx)
        else if (ts.isIdentifier(unwrap(el))) this.fromExpression(s, el, ctx, depth + 1)
        else s.fail(el, `unsupported route "${el.getText(s.sf)}"`)
      }
      return
    }
    if (ts.isObjectLiteralExpression(e)) { this.fromObject(s, e, ctx); return; }
    if (ts.isIdentifier(e)) {
      const b = s.binding(e.text, e)
      if (!b) return
      if (ts.isFunctionDeclaration(b.value)) {
        s.fail(e, `routes come from ${e.text}, which is a function`)
        return
      }
      this.fromExpression(b.scope, b.value, ctx, depth + 1)
      return
    }
    if (ts.isCallExpression(e) && isCallTo(e, ROUTES_FROM_ELEMENTS)) {
      const arg = e.arguments[0]
      if (arg) this.fromJsxNodes(s, [arg], ctx)
      return
    }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      s.fail(e, `routes generated by .${e.expression.name.text}()`)
      return
    }
    s.fail(e, `routes generated by "${e.getText(s.sf).slice(0, 80)}"`)
  }

  fromObject(s: Scope, obj: ts.ObjectLiteralExpression, ctx: Ctx): void {
    const def = new DefBuilder(s)
    let children: ts.Expression | undefined
    for (const prop of obj.properties) {
      if (ts.isSpreadAssignment(prop)) {
        def.reject(prop, `spread in route object "${prop.getText(s.sf)}"`)
        continue
      }
      const name = propertyName(prop.name)
      if (name === undefined) {
        def.reject(prop, 'computed property name in route object')
        continue
      }
      let value: ts.Node | undefined
      if (ts.isPropertyAssignment(prop)) value = prop.initializer
      else if (ts.isShorthandPropertyAssignment(prop)) value = prop.name
      else if (ts.isMethodDeclaration(prop)) value = prop
      if (value === undefined) {
        if (ROUTE_KEYS.has(name)) def.reject(prop, `unsupported "${name}" accessor`)
        continue
      }
      if (name === 'children') {
        if (ts.isExpression(value)) children = value
        else def.reject(prop, 'unsupported children')
        continue
      }
      def.set(name, value, prop)
    }
    const built = def.build()
    if (built) this.emit(built, ctx, children ? (child: Ctx) => { this.fromExpression(s, children, child); } : undefined)
  }

  /** Routes from JSX children of <Routes>, a fragment, or the argument of createRoutesFromElements(). */
  fromJsxNodes(s: Scope, nodes: readonly ts.Node[], ctx: Ctx): void {
    for (const raw of nodes) {
      const node = ts.isExpression(raw) ? unwrap(raw) : raw
      if (ts.isJsxText(node)) continue
      if (ts.isJsxFragment(node)) {
        this.fromJsxNodes(s, node.children, ctx)
      } else if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
        if (ts.isIdentifier(tagName) && tagName.text === 'Route') this.fromJsxRoute(s, node, ctx)
        else s.fail(node, `unexpected <${tagName.getText(s.sf)}> among routes`)
      } else if (ts.isJsxExpression(node)) {
        if (node.expression) s.fail(node, `routes generated in JSX: "${node.getText(s.sf).slice(0, 80)}"`)
      } else {
        s.fail(node, `unsupported routes "${node.getText(s.sf).slice(0, 80)}"`)
      }
    }
  }

  private fromJsxRoute(s: Scope, node: ts.JsxElement | ts.JsxSelfClosingElement, ctx: Ctx): void {
    const def = new DefBuilder(s)
    const attrs = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes
    for (const attr of attrs.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        def.reject(attr, 'spread attributes on <Route>')
        continue
      }
      const name = ts.isIdentifier(attr.name) ? attr.name.text : undefined
      if (name === undefined) continue
      const init = attr.initializer
      if (init === undefined) {
        // A bare attribute is `true`: meaningful for `index`, an error for the other route keys.
        if (name === 'index') def.index = true
        else if (ROUTE_KEYS.has(name)) def.reject(attr, `attribute ${name} without a value`)
        continue
      }
      const value = ts.isJsxExpression(init) ? init.expression : init
      if (!value) continue
      def.set(name, value, attr)
    }
    const built = def.build()
    if (built) this.emit(built, ctx, ts.isJsxElement(node) ? (child: Ctx) => { this.fromJsxNodes(s, node.children, child); } : undefined)
  }
}

export const ROUTER_FACTORIES = new Set(['createBrowserRouter', 'createHashRouter', 'createMemoryRouter', 'createStaticRouter', 'useRoutes'])
export const ROUTES_FROM_ELEMENTS = new Set(['createRoutesFromElements', 'createRoutesFromChildren'])

export function isCallTo(call: ts.CallExpression, names: ReadonlySet<string>): boolean {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return names.has(callee.text)
  if (ts.isPropertyAccessExpression(callee)) return names.has(callee.name.text)
  return false
}
