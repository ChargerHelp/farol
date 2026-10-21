import ts from 'typescript'
import { compareStrings } from '../../output/order.js'
import type { RouteAdapter, RouteAdapterInput, RouteTable } from '../types.js'
import { isCallTo, ROUTE_KEYS, RouteCollector, ROOT_CTX, ROUTER_FACTORIES, ROUTES_FROM_ELEMENTS } from './builders.js'
import { propertyName, Registry, unwrap, type Scope } from './scope.js'

/** An exported array counts as a route table only when every object in it has a route key. */
function looksLikeRouteArray(expr: ts.Expression): boolean {
  const e = unwrap(expr)
  if (!ts.isArrayLiteralExpression(e) || e.elements.length === 0) return false
  return e.elements.every((el) => {
    const o = unwrap(el)
    if (!ts.isObjectLiteralExpression(o)) return true // spreads and identifiers are reported by the collector
    return o.properties.some((p) => p.name !== undefined && ROUTE_KEYS.has(propertyName(p.name) ?? ''))
  })
}

function isRoutesElement(node: ts.Node): node is ts.JsxElement {
  return ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName) && node.openingElement.tagName.text === 'Routes'
}

function collectRoots(scope: Scope, collector: RouteCollector): number {
  const handled = new Set<ts.Node>()
  let roots = 0
  const handleArray = (expr: ts.Expression): void => {
    const target = unwrap(expr)
    // The same array may be exported and passed to createBrowserRouter: count it once.
    const resolved = ts.isIdentifier(target) ? scope.local(target.text) : target
    if (resolved && handled.has(resolved)) return
    if (resolved) handled.add(resolved)
    roots++
    collector.fromExpression(scope, expr, ROOT_CTX)
  }
  const visit = (node: ts.Node): void => {
    if (handled.has(node)) return
    if (ts.isCallExpression(node) && isCallTo(node, ROUTER_FACTORIES)) {
      const arg = node.arguments[0]
      if (arg) handleArray(arg)
      else scope.fail(node, 'router created without routes')
    } else if (ts.isCallExpression(node) && isCallTo(node, ROUTES_FROM_ELEMENTS)) {
      handled.add(node)
      roots++
      collector.fromJsxNodes(scope, node.arguments, ROOT_CTX)
      return
    } else if (isRoutesElement(node)) {
      roots++
      collector.fromJsxNodes(scope, node.children, ROOT_CTX)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(scope.sf)
  for (const statement of scope.sf.statements) {
    if (ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of statement.declarationList.declarations) {
        if (decl.initializer && !handled.has(unwrap(decl.initializer)) && looksLikeRouteArray(decl.initializer)) handleArray(decl.initializer)
      }
    } else if (ts.isExportAssignment(statement) && !handled.has(unwrap(statement.expression)) && looksLikeRouteArray(statement.expression)) {
      handleArray(statement.expression)
    }
  }
  return roots
}

function extract(input: RouteAdapterInput): RouteTable {
  const registry = new Registry(input)
  const scope = registry.scopeFor(input.file, input.code)
  const collector = new RouteCollector()
  if (scope && collectRoots(scope, collector) === 0) {
    registry.dynamic.push({
      file: input.file,
      line: 1,
      detail: 'no route table found; supported forms: createBrowserRouter/createHashRouter/createMemoryRouter/useRoutes with an array, an exported route array, <Routes>, createRoutesFromElements',
    })
  }
  const routes = collector.routes.sort((a, b) => compareStrings(a.key, b.key) || compareStrings(a.path, b.path))
  const dynamic = registry.dynamic.sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.detail, b.detail))
  const sources = registry.sources()
  return { routes, dynamic, sources: sources.length > 0 ? sources : [input.file] }
}

export const reactRouterAdapter: RouteAdapter = { name: 'react-router', source: 'file', extract }
