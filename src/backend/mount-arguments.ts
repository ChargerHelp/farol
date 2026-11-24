import ts from 'typescript'
import { sortedUnique } from '../output/order.js'

/** An object type written inline (`{ execute(…): … }`): no class implements it, so a call on it reaches no code. */
const isInline = (type: ts.Type): boolean => (type.getSymbol()?.declarations ?? []).some(ts.isTypeLiteralNode)

/**
 * Files of the project classes a factory call passes where the factory's parameter type is inline: the parameter
 * itself, or one of its properties (one level). The argument's own type is read, so generic factories need nothing
 * more. A class argument is not expanded into its fields. Parameters typed with a class or a port are left out: calls
 * on them already reach the class, per handler or through `implements`.
 */
export function inlineArgumentClasses(call: ts.CallExpression, checker: ts.TypeChecker, classFile: (decl: ts.Declaration) => string | undefined): string[] {
  // A call farol cannot resolve has no signature, or a signature with no declaration: no parameters.
  const decl: ts.Node | undefined = checker.getResolvedSignature(call)?.getDeclaration()
  const params = decl !== undefined && ts.isFunctionLike(decl) ? decl.parameters : []
  const solid = (type: ts.Type): ts.Type => checker.getNonNullableType(type)
  const classes = (type: ts.Type): ts.Declaration[] => (solid(type).getSymbol()?.declarations ?? []).filter(ts.isClassLike)
  const files = (type: ts.Type): string[] => classes(type).flatMap((d) => classFile(d) ?? [])
  return sortedUnique(
    call.arguments.flatMap((arg, i) => {
      const param = params[i]
      if (!param || param.dotDotDotToken || ts.isSpreadElement(arg)) return []
      const paramType = solid(checker.getTypeAtLocation(param))
      const argType = checker.getTypeAtLocation(arg)
      if (classes(argType).length > 0) return isInline(paramType) ? files(argType) : []
      return checker.getPropertiesOfType(paramType).flatMap((p) => {
        if (!isInline(solid(checker.getTypeOfSymbolAtLocation(p, param)))) return []
        const passed = checker.getPropertyOfType(solid(argType), p.name)
        return passed ? files(checker.getTypeOfSymbolAtLocation(passed, arg)) : []
      })
    }),
  )
}
