import ts from 'typescript'

/** Globals a module defines with `global.X = …` / `globalThis.X = …` (e.g. a service locator like `Core`). */
export function definedGlobals(sf: ts.SourceFile): string[] {
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      const target = node.left.expression
      if (ts.isIdentifier(target) && (target.text === 'global' || target.text === 'globalThis' || target.text === 'window')) names.push(node.left.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** Whether a file reads a global by name (an identifier with no declaration the compiler can see). */
export function usesGlobal(sf: ts.SourceFile, name: string, checker: ts.TypeChecker): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === name && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      const symbol = checker.getSymbolAtLocation(node)
      const decls = symbol?.declarations ?? []
      if (decls.every((d) => d.getSourceFile().isDeclarationFile)) found = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}
