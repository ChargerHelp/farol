import ts from 'typescript'
import { compareStrings } from '../../output/order.js'
import { isTypeOnlyImport, parseIsolated, unwrap } from '../../project/parse.js'

export { unwrap }
import type { DynamicRoute, RouteAdapterInput } from '../types.js'
import { lazyImports } from './lazy.js'

export type FunctionLike = ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration | ts.FunctionDeclaration

export function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)
}

/** Name of a property when it is a plain identifier or string; undefined for computed names. */
export function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  return undefined
}

export interface Modules {
  entry: string | null
  modules: string[]
}

/** A value and the module it is written in (identifiers inside it resolve in that module). */
export interface Binding {
  scope: Scope
  value: ts.Expression | ts.FunctionDeclaration
}

/** Parses each module once and collects every unsupported construct of the whole route tree. */
export class Registry {
  readonly dynamic: DynamicRoute[] = []
  private readonly scopes = new Map<string, Scope | null>()

  constructor(readonly input: RouteAdapterInput) {}

  scopeFor(file: string, code?: string): Scope | null {
    if (this.scopes.has(file)) return this.scopes.get(file) ?? null
    const text = code ?? this.input.read(file)
    if (text === undefined) {
      this.scopes.set(file, null)
      return null
    }
    const { sourceFile, errors } = parseIsolated(file, text)
    for (const e of errors) this.dynamic.push({ file, line: e.line, detail: `syntax error: ${e.message}` })
    const scope = errors.length > 0 ? null : new Scope(sourceFile, file, this)
    this.scopes.set(file, scope)
    return scope
  }

  /** Files whose code the table was read from. */
  sources(): string[] {
    return [...this.scopes.entries()].filter(([, s]) => s !== null).map(([f]) => f).sort(compareStrings)
  }
}

interface ImportBinding {
  spec: string
  /** 'default', '*' (namespace) or the exported name. */
  imported: string
}

/**
 * What one module can see: its imports, its top-level constants and functions, and its exports.
 * Every unsupported construct is recorded with `fail`, which returns null.
 */
export class Scope {
  private readonly imports = new Map<string, ImportBinding>()
  private readonly locals = new Map<string, ts.Expression | ts.FunctionDeclaration>()
  private readonly exportNames = new Map<string, string>()
  private readonly reexports: { spec: string; names: Map<string, string> | 'all' }[] = []
  private defaultExport: ts.Expression | ts.FunctionDeclaration | undefined

  constructor(
    readonly sf: ts.SourceFile,
    readonly file: string,
    readonly registry: Registry,
  ) {
    for (const statement of sf.statements) this.index(statement)
  }

  private index(statement: ts.Statement): void {
    const exported = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause && !isTypeOnlyImport(statement.importClause)) {
      const spec = statement.moduleSpecifier.text
      const clause = statement.importClause
      if (clause.name) this.imports.set(clause.name.text, { spec, imported: 'default' })
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) this.imports.set(bindings.name.text, { spec, imported: '*' })
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) if (!el.isTypeOnly) this.imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text })
      }
    } else if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        this.locals.set(decl.name.text, decl.initializer)
        if (exported) this.exportNames.set(decl.name.text, decl.name.text)
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      this.locals.set(statement.name.text, statement)
      if (exported) this.exportNames.set(statement.name.text, statement.name.text)
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      this.defaultExport = statement.expression
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const spec = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined
      const clause = statement.exportClause
      if (clause && ts.isNamedExports(clause)) {
        const names = new Map(clause.elements.filter((e) => !e.isTypeOnly).map((e) => [e.name.text, (e.propertyName ?? e.name).text]))
        if (spec === undefined) for (const [exportedName, local] of names) this.exportNames.set(exportedName, local)
        else this.reexports.push({ spec, names })
      } else if (!clause && spec !== undefined) {
        this.reexports.push({ spec, names: 'all' })
      }
    }
  }

  fail(node: ts.Node, detail: string): null {
    const line = this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1
    this.registry.dynamic.push({ file: this.file, line, detail })
    return null
  }

  /** Top-level constant or function of this module (no imports). */
  local(name: string): ts.Expression | ts.FunctionDeclaration | undefined {
    const value = this.locals.get(name)
    return value && !ts.isFunctionDeclaration(value) ? unwrap(value) : value
  }

  /** Repo path of an imported module, `package:<spec>` for packages, null (recorded) when unresolved. */
  resolveSpecifier(specifier: string, node: ts.Node): string | null {
    const r = this.registry.input.resolve(specifier, this.file)
    if (r.kind === 'module') return r.file
    if (r.kind === 'external') return `package:${r.specifier}`
    return this.fail(node, `cannot resolve import "${specifier}"`)
  }

  /** The value an identifier refers to: a local constant/function, or an export of another project module. */
  binding(name: string, node: ts.Node): Binding | null {
    const value = this.local(name)
    if (value) return { scope: this, value }
    const imp = this.imports.get(name)
    if (!imp) return this.fail(node, `${name} is not declared in ${this.file}`)
    if (imp.imported === '*') return this.fail(node, `namespace import ${name} cannot be followed`)
    const target = this.resolveSpecifier(imp.spec, node)
    if (target === null) return null
    if (target.startsWith('package:')) return this.fail(node, `${name} comes from the package ${imp.spec}`)
    const found = this.registry.scopeFor(target)?.exportedBinding(imp.imported, new Set())
    return found ?? this.fail(node, `cannot find the export ${imp.imported} of ${target}`)
  }

  /** Follows `export const`, `export { a as b }`, `export default`, `export { x } from` and `export *`. */
  exportedBinding(name: string, seen: Set<string>): Binding | undefined {
    const key = `${this.file}\0${name}`
    if (seen.has(key)) return undefined
    seen.add(key)
    if (name === 'default' && this.defaultExport) return { scope: this, value: this.defaultExport }
    const local = this.exportNames.get(name)
    if (local !== undefined) {
      const value = this.local(local)
      if (value) return { scope: this, value }
      const imp = this.imports.get(local)
      if (imp && imp.imported !== '*') return this.followImport(imp.spec, imp.imported, seen)
      return undefined
    }
    for (const re of this.reexports) {
      if (re.names === 'all') {
        if (name === 'default') continue
        const found = this.followImport(re.spec, name, seen)
        if (found) return found
      } else {
        const imported = re.names.get(name)
        if (imported !== undefined) return this.followImport(re.spec, imported, seen)
      }
    }
    return undefined
  }

  private followImport(spec: string, imported: string, seen: Set<string>): Binding | undefined {
    const r = this.registry.input.resolve(spec, this.file)
    if (r.kind !== 'module') return undefined
    return this.registry.scopeFor(r.file)?.exportedBinding(imported, seen)
  }

  /** Object literal behind an expression (a literal, or a constant holding one, here or in another module). */
  objectLiteral(expr: ts.Expression, depth = 0): { scope: Scope; object: ts.ObjectLiteralExpression } | undefined {
    const e = unwrap(expr)
    if (ts.isObjectLiteralExpression(e)) return { scope: this, object: e }
    if (ts.isIdentifier(e) && depth < 20) {
      const b = this.bindingQuiet(e.text)
      if (b && !ts.isFunctionDeclaration(b.value)) return b.scope.objectLiteral(b.value, depth + 1)
    }
    return undefined
  }

  /** Like `binding`, without recording a failure (callers report one precise message instead). */
  bindingQuiet(name: string): Binding | undefined {
    const before = this.registry.dynamic.length
    const b = this.binding(name, this.sf)
    this.registry.dynamic.length = before
    return b ?? undefined
  }

  /** String value of a literal, a template with constant parts, a constant, or a property of a constant object. */
  stringValue(expr: ts.Expression, depth = 0): string | undefined {
    if (depth > 20) return undefined
    const e = unwrap(expr)
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
    if (ts.isTemplateExpression(e)) {
      let text = e.head.text
      for (const span of e.templateSpans) {
        const part = this.stringValue(span.expression, depth + 1)
        if (part === undefined) return undefined
        text += part + span.literal.text
      }
      return text
    }
    if (ts.isIdentifier(e)) {
      const b = this.bindingQuiet(e.text)
      return b && !ts.isFunctionDeclaration(b.value) ? b.scope.stringValue(b.value, depth + 1) : undefined
    }
    if (ts.isPropertyAccessExpression(e) || (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression))) {
      const key = ts.isPropertyAccessExpression(e) ? e.name.text : (e.argumentExpression as ts.StringLiteralLike).text
      const holder = this.objectLiteral(e.expression)
      if (!holder) return undefined
      for (const prop of holder.object.properties) {
        if (ts.isPropertyAssignment(prop) && propertyName(prop.name) === key) return holder.scope.stringValue(prop.initializer, depth + 1)
      }
    }
    return undefined
  }

  /** Module of a component referenced by name: an import, or a local `lazy(() => import("…"))` constant. */
  resolveComponent(name: string, node: ts.Node): string | null {
    const imp = this.imports.get(name)
    if (imp !== undefined) return this.resolveSpecifier(imp.spec, node)
    const value = this.local(name)
    if (value && ts.isCallExpression(value)) {
      const loader = value.arguments.find((a) => isFunctionLike(a))
      if (loader) return lazyImports(this, loader, node)?.[0] ?? null
    }
    if (value) return this.fail(node, `component ${name} is declared in the routes file; import it from its own module`)
    return this.fail(node, `cannot resolve component ${name}`)
  }

  /** Component given as a value (`Component: X`, `ErrorBoundary: X`). */
  componentValue(expr: ts.Expression): Modules | null {
    const e = unwrap(expr)
    if (e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) return { entry: null, modules: [] }
    let id: ts.Expression = e
    while (ts.isPropertyAccessExpression(id)) id = id.expression
    if (!ts.isIdentifier(id)) return this.fail(e, `unsupported component value "${e.getText(this.sf)}"`)
    const m = this.resolveComponent(id.text, e)
    return m === null ? null : { entry: m, modules: [m] }
  }

  /** Modules of a `lazy` value: a function, an object of functions (lazy: { Component: … }) or a function constant. */
  lazyValue(value: ts.Node): Modules | null {
    const v: ts.Node = ts.isExpression(value) ? unwrap(value) : value
    if (ts.isIdentifier(v)) {
      const b = this.binding(v.text, v)
      if (!b) return null
      return b.scope.lazyValue(b.value)
    }
    if (isFunctionLike(v) || ts.isObjectLiteralExpression(v) || ts.isCallExpression(v)) {
      const modules = lazyImports(this, v, v)
      return modules === null ? null : { entry: modules[0] ?? null, modules }
    }
    return this.fail(v, `unsupported lazy value "${v.getText(this.sf)}"`)
  }
}
