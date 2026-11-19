import ts from 'typescript'
import { compareStrings, sortedUnique } from '../output/order.js'

/**
 * Members of project ports (interfaces and named object types), with the files of the classes that implement them
 * (`class A implements I`). A use of a member runs one of these classes: reach goes from the user to their files.
 */
export interface Implementers {
  /** Names of the members: an identifier with another name needs no look-up. */
  names: ReadonlySet<string>
  /** The files that implement what a symbol declares: none for anything but a member of a project port. */
  filesFor: (symbol: ts.Symbol | undefined) => readonly string[]
}

/** A method or property signature of an interface or of a named object type (`type IRepo = { find(): … }`). */
const isPortMember = (d: ts.Declaration): boolean =>
  (ts.isMethodSignature(d) || ts.isPropertySignature(d)) && (ts.isInterfaceDeclaration(d.parent) || (ts.isTypeLiteralNode(d.parent) && ts.isTypeAliasDeclaration(d.parent.parent)))

/** Member declarations of a project port that a type in an `implements` clause has, with their names. */
function portMembers(expr: ts.ExpressionWithTypeArguments, checker: ts.TypeChecker, isProjectFile: (fileName: string) => boolean): [ts.Declaration, string][] {
  return checker.getPropertiesOfType(checker.getTypeAtLocation(expr)).flatMap((property) =>
    (property.declarations ?? []).filter((d) => isPortMember(d) && isProjectFile(d.getSourceFile().fileName) && !d.getSourceFile().isDeclarationFile).map((d): [ts.Declaration, string] => [d, property.name]),
  )
}

/**
 * Every member of each type in the `implements` clause of a class of `files`, keyed by its declaration. Aliases,
 * inherited interfaces, `Pick<…>` and generics all lead to the declaration of the member, so a use of the member
 * finds the class whatever type the caller holds. Ports outside the project (`implements Map`) do not count.
 */
export function implementersOf(files: readonly ts.SourceFile[], checker: ts.TypeChecker, isProjectFile: (fileName: string) => boolean, rel: (fileName: string) => string): Implementers {
  const byDeclaration = new Map<ts.Declaration, Set<string>>()
  const names = new Set<string>()
  for (const sf of files) {
    const file = rel(sf.fileName)
    const visit = (node: ts.Node): void => {
      if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) {
        for (const [d, name] of node.types.flatMap((expr) => portMembers(expr, checker, isProjectFile))) {
          byDeclaration.set(d, (byDeclaration.get(d) ?? new Set<string>()).add(file))
          names.add(name)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  const sorted = new Map([...byDeclaration].map(([d, f]) => [d, sortedUnique(f)]))
  return {
    names,
    filesFor: (symbol) => (symbol === undefined || !names.has(symbol.name) ? [] : sortedUnique((symbol.declarations ?? []).flatMap((d) => sorted.get(d) ?? []))),
  }
}

/**
 * Import graph edges: each file that uses a member of a project port (`repo.find()`, `const { find: f } = repo`)
 * points at the files that implement it. Types never run, so annotations and port declarations are not uses.
 */
export function implementationUses(files: readonly ts.SourceFile[], checker: ts.TypeChecker, implementers: Implementers, rel: (fileName: string) => string): { from: string; to: string }[] {
  if (implementers.names.size === 0) return []
  const edges = new Map<string, { from: string; to: string }>()
  for (const sf of files) {
    const from = rel(sf.fileName)
    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return
      if (ts.isIdentifier(node) && implementers.names.has(node.text)) {
        for (const to of implementers.filesFor(checker.getSymbolAtLocation(node))) if (to !== from) edges.set(`${from}\0${to}`, { from, to })
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return [...edges.values()].sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.to, b.to))
}
