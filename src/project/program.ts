import ts from 'typescript'
import { posix } from 'node:path'
import type { ProjectFileSystem } from './fs.js'

export interface ProjectProgram {
  program: ts.Program
  options: ts.CompilerOptions
  /** Absolute path of the tsconfig actually used (a project reference when the root config is solution-style). */
  configPath: string
  resolutionHost: ts.ModuleResolutionHost
  resolutionCache: ts.ModuleResolutionCache
  fs: ProjectFileSystem
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

interface MatchFiles {
  (
    path: string,
    extensions: readonly string[] | undefined,
    excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined,
    useCaseSensitiveFileNames: boolean,
    currentDirectory: string,
    depth: number | undefined,
    getFileSystemEntries: (path: string) => { files: readonly string[]; directories: readonly string[] },
    realpath: (path: string) => string,
  ): string[]
}

function parseConfigHost(fs: ProjectFileSystem, cwd: string): ts.ParseConfigFileHost {
  // tsconfig `include` globs need directory walking with TypeScript's exact semantics; `matchFiles` is the
  // compiler's own implementation (internal but stable for years). See docs/DECISIONS.md.
  const matchFiles = (ts as unknown as { matchFiles?: MatchFiles }).matchFiles
  if (typeof matchFiles !== 'function') throw new ProjectError('this TypeScript version does not expose matchFiles; reinstall the pinned typescript version')
  return {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => cwd,
    fileExists: (p) => fs.fileExists(p),
    readFile: (p) => fs.readFile(p),
    readDirectory: (root, extensions, excludes, includes, depth) =>
      matchFiles(root, extensions, excludes, includes, true, cwd, depth, (p) => fs.getEntries(p), (p) => fs.realpath(p)),
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new ProjectError(`cannot read tsconfig: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
    },
  }
}

function parseTsconfig(configPath: string, fs: ProjectFileSystem, cwd: string): ts.ParsedCommandLine {
  if (!fs.fileExists(configPath)) throw new ProjectError(`tsconfig not found at ${configPath}; adjust "tsconfig" in the configuration`)
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, parseConfigHost(fs, cwd))
  if (!parsed) throw new ProjectError(`cannot parse ${configPath}`)
  const fatal = parsed.errors.filter((d) => d.category === ts.DiagnosticCategory.Error && d.code !== 18003)
  if (fatal.length > 0) {
    const messages = fatal.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    throw new ProjectError(`invalid tsconfig ${configPath}: ${messages.join('; ')}`)
  }
  return parsed
}

/**
 * Picks the configuration that compiles `anchorFile`: the root tsconfig itself, or, for solution-style configs
 * (`files: []` + `references`), the referenced config whose files include it.
 */
function selectConfig(rootConfig: string, anchorFile: string | undefined, fs: ProjectFileSystem, cwd: string): { parsed: ts.ParsedCommandLine; configPath: string } {
  const parsed = parseTsconfig(rootConfig, fs, cwd)
  if (anchorFile === undefined || parsed.fileNames.includes(anchorFile) || !parsed.projectReferences?.length) return { parsed, configPath: rootConfig }
  for (const ref of parsed.projectReferences) {
    const refPath = fs.directoryExists(ref.path) ? posix.join(ref.path, 'tsconfig.json') : ref.path
    const child = parseTsconfig(refPath, fs, cwd)
    if (child.fileNames.includes(anchorFile)) return { parsed: child, configPath: refPath }
  }
  return { parsed, configPath: rootConfig }
}

/**
 * Creates the TypeScript program of the project. Only module resolution options matter for the analysis,
 * so lib files and ambient types are never loaded (see docs/DECISIONS.md).
 */
export function createProjectProgram(input: { fs: ProjectFileSystem; projectDir: string; tsconfigPath: string; anchorFile?: string }): ProjectProgram {
  const { fs, projectDir } = input
  const { parsed, configPath } = selectConfig(input.tsconfigPath, input.anchorFile, fs, projectDir)
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noLib: true,
    types: [],
    noEmit: true,
    skipLibCheck: true,
    composite: false,
    incremental: false,
    declaration: false,
    emitDeclarationOnly: false,
  }
  const host = ts.createCompilerHost(options, true)
  host.fileExists = (p) => fs.fileExists(p)
  host.readFile = (p) => fs.readFile(p)
  host.directoryExists = (p) => fs.directoryExists(p)
  host.getDirectories = (p) => fs.getDirectories(p)
  host.realpath = (p) => fs.realpath(p)
  host.getCurrentDirectory = () => projectDir
  host.useCaseSensitiveFileNames = () => true
  host.getCanonicalFileName = (f) => f
  host.getDefaultLibFileName = () => posix.join(projectDir, '__farol_no_lib__.d.ts')
  host.writeFile = () => undefined
  host.getSourceFile = (fileName, languageVersionOrOptions) => {
    const text = fs.readFile(fileName)
    return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersionOrOptions, true)
  }
  const rootNames = input.anchorFile === undefined || parsed.fileNames.includes(input.anchorFile) ? parsed.fileNames : [...parsed.fileNames, input.anchorFile]
  const program = ts.createProgram({ rootNames, options, host, projectReferences: undefined })
  const resolutionCache = ts.createModuleResolutionCache(projectDir, (f) => f, options)
  return { program, options, configPath, resolutionHost: host, resolutionCache, fs }
}
