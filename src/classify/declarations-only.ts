import ts from 'typescript'
import { parseIsolated } from '../project/parse.js'

const SCRIPT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/** TypeScript and JavaScript files: the only ones that can be declaration-only modules. */
export const isScriptFile = (file: string): boolean => SCRIPT.test(file)

/**
 * An expression that only builds a value: literals, objects and arrays of them, references, `as const`; an arrow
 * function that only returns such a value (`(p) => ({ key: 'x', p })`); a call of a named function with such
 * arguments only, none of them a call (`defineKeys({ … })`, a typed identity wrapper). No other functions, statements or JSX.
 */
function isStaticValue(e: ts.Expression, depth = 0, calls = true): boolean {
  if (depth > 20) return false
  const value = (x: ts.Expression): boolean => isStaticValue(x, depth + 1, calls)
  if (ts.isArrowFunction(e)) return !ts.isBlock(e.body) && value(e.body)
  // The wrapper takes the declared value: at least one argument, and no call inside its arguments.
  if (ts.isCallExpression(e)) return calls && (ts.isIdentifier(e.expression) || ts.isPropertyAccessExpression(e.expression)) && value(e.expression) && e.arguments.length > 0 && e.arguments.every((a) => !ts.isSpreadElement(a) && isStaticValue(a, depth + 1, false))
  if (ts.isStringLiteral(e) || ts.isNumericLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isBigIntLiteral(e) || ts.isRegularExpressionLiteral(e)) return true
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) return ts.isIdentifier(e) || value(e.expression)
  if (ts.isPrefixUnaryExpression(e)) return (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken) && value(e.operand)
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) return value(e.expression)
  if (ts.isTemplateExpression(e)) return e.templateSpans.every((s) => value(s.expression))
  if (ts.isArrayLiteralExpression(e)) return e.elements.every((x) => (ts.isSpreadElement(x) ? value(x.expression) : value(x)))
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.every((p) => {
      if (ts.isPropertyAssignment(p)) return (!ts.isComputedPropertyName(p.name) || value(p.name.expression)) && value(p.initializer)
      if (ts.isShorthandPropertyAssignment(p)) return true
      if (ts.isSpreadAssignment(p)) return value(p.expression)
      return false
    })
  }
  return false
}

/**
 * Whether a module only declares things: types, interfaces, enums, imports and re-exports, and constants holding static
 * values (`export const LIMITS = { max: 10 } as const`). Such a file runs no logic of its own. False for anything
 * else, a parse error or a non-script file (fail closed).
 */
export function isDeclarationsOnlyModule(file: string, code: string): boolean {
  if (!SCRIPT.test(file) || file.endsWith('.test.ts')) return false
  const { sourceFile: sf, errors } = parseIsolated(file, code)
  if (errors.length > 0) return false
  return sf.statements.every((s) => {
    if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) return true
    // A side-effect import (`import './x'`) runs code.
    if (ts.isImportDeclaration(s)) return s.importClause !== undefined
    if (ts.isExportDeclaration(s)) return true
    if (ts.isExportAssignment(s)) return isStaticValue(s.expression)
    const modifiers = ts.canHaveModifiers(s) ? (ts.getModifiers(s) ?? []) : []
    if (modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return true
    if (ts.isVariableStatement(s)) {
      const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0
      return isConst && s.declarationList.declarations.every((d) => d.initializer !== undefined && ts.isIdentifier(d.name) && isStaticValue(d.initializer))
    }
    return false
  })
}
