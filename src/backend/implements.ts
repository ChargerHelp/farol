import ts from 'typescript'
import { compareStrings, sortedUnique } from '../output/order.js'

/**
 * Members of project interfaces, with the files of the classes that implement them (`class A implements I`).
 * A call to a member of an interface runs one of these classes: reach goes from the caller to their files.
 */
export interface Implementers {
  /** Names of the members: other identifiers need no look-up. */
  names: ReadonlySet<string>
  /** The files that implement a member declaration (a method or property signature of an interface). */
  filesOf: (declaration: ts.Declaration) => readonly string[]
}

const isInterfaceMember = (d: ts.Declaration): boolean => (ts.isMethodSignature(d) || ts.isPropertySignature(d)) && ts.isInterfaceDeclaration(d.parent)

/**
 * Every member of each type in the `implements` clause of a class of `files`, keyed by its declaration. Aliases,
 * inherited interfaces, `Pick<…>` and generics all lead to the declaration of the member, so a use of the member
 * finds the class whatever type the caller holds. Interfaces outside the project (`implements Map`) do not count.
 */
export function implementersOf(files: readonly ts.SourceFile[], checker: ts.TypeChecker, isProjectFile: (fileName: string) => boolean, rel: (fileName: string) => string): Implementers {
  const byDeclaration = new Map<ts.Declaration, Set<string>>()
  const names = new Set<string>()
  for (const sf of files) {
    const file = rel(sf.fileName)
    const visit = (node: ts.Node): void => {
      if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword && ts.isClassLike(node.parent)) {
        for (const expr of node.types) {
          for (const property of checker.getPropertiesOfType(checker.getTypeAtLocation(expr))) {
            for (const d of property.declarations ?? []) {
              if (!isInterfaceMember(d) || !isProjectFile(d.getSourceFile().fileName) || d.getSourceFile().isDeclarationFile) continue
              byDeclaration.set(d, (byDeclaration.get(d) ?? new Set<string>()).add(file))
              names.add(property.name)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  const sorted = new Map([...byDeclaration].map(([d, f]) => [d, sortedUnique(f)]))
  return { names, filesOf: (d) => sorted.get(d) ?? [] }
}

/** Files that implement what a symbol declares (none for anything but a member of a project interface). */
export function implementingFiles(implementers: Implementers, symbol: ts.Symbol | undefined): string[] {
  return sortedUnique((symbol?.declarations ?? []).flatMap((d) => implementers.filesOf(d)))
}

/** Import graph edges: each file that uses a member of a project interface (`repo.find()`) points at the files that implement it. */
export function implementationUses(files: readonly ts.SourceFile[], checker: ts.TypeChecker, implementers: Implementers, rel: (fileName: string) => string): { from: string; to: string }[] {
  if (implementers.names.size === 0) return []
  const edges = new Map<string, { from: string; to: string }>()
  for (const sf of files) {
    const from = rel(sf.fileName)
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && implementers.names.has(node.text) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
        for (const to of implementingFiles(implementers, checker.getSymbolAtLocation(node))) if (to !== from) edges.set(`${from}\0${to}`, { from, to })
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return [...edges.values()].sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.to, b.to))
}
