import ts from 'typescript'
import { sortedUnique } from '../../output/order.js'
import { unwrap, type Modules, type Scope } from './scope.js'

function isJsx(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
}

function containsJsx(node: ts.Node): boolean {
  if (isJsx(node)) return true
  return ts.forEachChild(node, (child) => (containsJsx(child) ? true : undefined)) ?? false
}

/**
 * Modules rendered by a JSX element. The entry is the innermost component (children are visited before the
 * wrapper tag and its attributes), so `<Suspense fallback={<Spinner/>}><Page/></Suspense>` has entry Page.
 */
export function elementModules(scope: Scope, expr: ts.Expression): Modules | null {
  const e = unwrap(expr)
  if (e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) return { entry: null, modules: [] }
  if (ts.isIdentifier(e)) {
    const b = scope.bindingQuiet(e.text)
    if (!b || ts.isFunctionDeclaration(b.value) || !isJsx(unwrap(b.value))) return scope.fail(e, `element ${e.text} is not a JSX constant`)
    return elementModules(b.scope, b.value)
  }
  const root: ts.Node = e
  if (!isJsx(root)) return scope.fail(e, `unsupported element value "${e.getText(scope.sf)}"`)

  const ordered: string[] = []
  const state = { failed: false }
  const tag = (name: ts.JsxTagNameExpression, node: ts.Node): void => {
    let id: ts.Node = name
    while (ts.isPropertyAccessExpression(id)) id = id.expression
    if (!ts.isIdentifier(id)) return
    const text = id.text
    const first = text[0] ?? ''
    if (first === first.toLowerCase() && !text.includes('.')) return // intrinsic element (div, span…)
    const m = scope.resolveComponent(text, node)
    if (m === null) state.failed = true
    else ordered.push(m)
  }
  const inExpression = (node: ts.Node): void => {
    if (isJsx(node)) visit(node)
    else ts.forEachChild(node, inExpression)
  }
  const attributes = (attrs: ts.JsxAttributes): void => {
    for (const attr of attrs.properties) if (ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer)) inExpression(attr.initializer)
  }
  const children = (list: ts.NodeArray<ts.JsxChild>): void => {
    for (const child of list) {
      if (ts.isJsxText(child)) continue
      if (ts.isJsxExpression(child)) {
        const inner = child.expression
        if (!inner || ts.isStringLiteralLike(inner) || ts.isNumericLiteral(inner)) continue
        if (containsJsx(inner)) inExpression(inner)
        else {
          scope.fail(child, `element content is computed: "${child.getText(scope.sf)}"`)
          state.failed = true
        }
        continue
      }
      visit(child)
    }
  }
  function visit(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): void {
    if (ts.isJsxFragment(node)) {
      children(node.children)
    } else if (ts.isJsxSelfClosingElement(node)) {
      tag(node.tagName, node)
      attributes(node.attributes)
    } else {
      children(node.children)
      tag(node.openingElement.tagName, node)
      attributes(node.openingElement.attributes)
    }
  }
  visit(root)
  if (state.failed) return null
  const entry = ordered.find((m) => !m.startsWith('package:')) ?? ordered[0] ?? null
  return { entry, modules: sortedUnique(ordered) }
}
