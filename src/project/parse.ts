import ts from 'typescript'

/** `import type …` (the `isTypeOnly` flag is deprecated in TypeScript 6 in favor of `phaseModifier`). */
export function isTypeOnlyImport(clause: ts.ImportClause): boolean {
  return clause.phaseModifier === ts.SyntaxKind.TypeKeyword
}

/** `baseUrl` is deprecated in TypeScript 6 but projects still use it, and resolution still honors it. */
export function getBaseUrl(options: ts.CompilerOptions): string | undefined {
  const value = (options as { baseUrl?: unknown }).baseUrl
  return typeof value === 'string' ? value : undefined
}

export interface IsolatedParse {
  sourceFile: ts.SourceFile
  errors: { line: number; message: string }[]
}

export function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')) return ts.ScriptKind.JS
  if (fileName.endsWith('.json')) return ts.ScriptKind.JSON
  return ts.ScriptKind.TS
}

/** Parses one file on its own (no program), with its syntax errors. */
export function parseIsolated(fileName: string, code: string): IsolatedParse {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, scriptKindFor(fileName))
  // `parseDiagnostics` is where the parser stores syntax errors; it is not in the public typings.
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics === undefined) throw new Error('internal: TypeScript did not expose parse diagnostics for an isolated file')
  const errors = diagnostics.map((d) => ({
    line: d.start === undefined ? 1 : sourceFile.getLineAndCharacterOfPosition(d.start).line + 1,
    message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
  }))
  return { sourceFile, errors }
}
