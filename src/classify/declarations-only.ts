import ts from 'typescript'
import { isStaticValue, parseIsolated } from '../project/parse.js'

const SCRIPT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/** TypeScript and JavaScript files: the only ones that can be declaration-only modules. */
export const isScriptFile = (file: string): boolean => SCRIPT.test(file)

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
