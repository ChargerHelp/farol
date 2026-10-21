import ts from 'typescript'
import type { Scope } from './scope.js'

/**
 * Modules loaded by literal `import()` calls in a function body (lazy routes, React.lazy). When the body has no
 * `import()`, the functions it calls by name are followed (memoized loaders like `() => (cache ??= load())`).
 */
export function lazyImports(scope: Scope, fn: ts.Node, node: ts.Node, seen = new Set<string>()): string[] | null {
  const specs: ts.StringLiteralLike[] = []
  const called: ts.Identifier[] = []
  let nonLiteral: ts.Node | undefined
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = n.arguments[0]
        if (arg && ts.isStringLiteralLike(arg)) specs.push(arg)
        else nonLiteral = n
      } else if (ts.isIdentifier(n.expression)) {
        called.push(n.expression)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(fn)
  if (nonLiteral) return scope.fail(nonLiteral, 'lazy import() with a computed path')
  const modules: string[] = []
  for (const spec of specs) {
    const m = scope.resolveSpecifier(spec.text, spec)
    if (m === null) return null
    modules.push(m)
  }
  if (modules.length > 0) return modules
  for (const id of called) {
    const key = `${scope.file}\0${id.text}`
    if (seen.has(key)) continue
    seen.add(key)
    const b = scope.bindingQuiet(id.text)
    if (!b) continue
    const value = b.value
    if (ts.isFunctionDeclaration(value) || ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      // A called helper without import() is not an error by itself: only the overall lookup can fail.
      const before = scope.registry.dynamic.length
      const followed = lazyImports(b.scope, value, node, seen)
      if (followed && followed.length > 0) return followed
      scope.registry.dynamic.length = before
    }
  }
  return scope.fail(node, 'lazy route without a literal import()')
}
