import ts from 'typescript'
import { posix } from 'node:path'
import { toPosix } from './fs.js'
import { getBaseUrl } from './parse.js'
import type { ProjectProgram } from './program.js'

/** What module resolution needs: a full program provides it, and so does a bare base-tree context. */
export type ResolverContext = Pick<ProjectProgram, 'options' | 'configPath' | 'resolutionHost' | 'resolutionCache' | 'fs'>

/** Resolution context without a program (used for the base tree, where only a few files are parsed). */
export function createResolverContext(input: { fs: ProjectProgram['fs']; options: ts.CompilerOptions; configPath: string; projectDir: string }): ResolverContext {
  const fs = input.fs
  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists: (p) => fs.fileExists(p),
    readFile: (p) => fs.readFile(p),
    directoryExists: (p) => fs.directoryExists(p),
    getDirectories: (p) => fs.getDirectories(p),
    realpath: (p) => fs.realpath(p),
    getCurrentDirectory: () => input.projectDir,
    useCaseSensitiveFileNames: true,
  }
  return {
    fs,
    options: input.options,
    configPath: input.configPath,
    resolutionHost,
    resolutionCache: ts.createModuleResolutionCache(input.projectDir, (f) => f, input.options),
  }
}

export type Resolution =
  | { kind: 'module'; file: string } // a TypeScript/JavaScript/JSON file of the program
  | { kind: 'asset'; file: string } // a non-TS file (CSS, SVG, …): leaf node
  | { kind: 'external' } // a package outside the repository
  | { kind: 'unresolved' }

const TS_LIKE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', ''])

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..' || specifier.startsWith('/')
}

function pathsBase(options: ts.CompilerOptions, configPath: string): string {
  const base = (options as { pathsBasePath?: unknown }).pathsBasePath
  if (typeof base === 'string') return toPosix(base)
  const baseUrl = getBaseUrl(options)
  if (baseUrl !== undefined) return toPosix(baseUrl)
  return posix.dirname(toPosix(configPath))
}

/** Candidate paths for a specifier through tsconfig `paths` (TypeScript's longest-prefix pattern semantics). */
function pathMappingCandidates(specifier: string, options: ts.CompilerOptions, configPath: string): string[] | undefined {
  const paths = options.paths
  if (!paths) return undefined
  let best: { pattern: string; star: string } | undefined
  for (const pattern of Object.keys(paths)) {
    const starIndex = pattern.indexOf('*')
    if (starIndex === -1) {
      if (pattern === specifier) {
        best = { pattern, star: '' }
        break
      }
      continue
    }
    const prefix = pattern.slice(0, starIndex)
    const suffix = pattern.slice(starIndex + 1)
    if (specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      if (!best || prefix.length > best.pattern.indexOf('*')) best = { pattern, star: specifier.slice(prefix.length, specifier.length - suffix.length) }
    }
  }
  if (!best) return undefined
  const base = pathsBase(options, configPath)
  return (paths[best.pattern] ?? []).map((target) => posix.resolve(base, target.replace('*', best.star)))
}

/** Absolute path a project specifier would point to (without extension probing), for diagnostics. */
export function specifierTarget(project: ResolverContext, containingFile: string, specifier: string): string | undefined {
  const cleaned = specifier.split('?')[0]?.split('#')[0] ?? specifier
  if (isRelative(cleaned)) return posix.resolve(posix.dirname(containingFile), cleaned)
  return pathMappingCandidates(cleaned, project.options, project.configPath)?.[0]
}

/** True when the specifier points into the project (relative, absolute, alias or baseUrl), not to a package. */
export function isProjectSpecifier(specifier: string, project: ResolverContext): boolean {
  if (isRelative(specifier)) return true
  if (pathMappingCandidates(specifier, project.options, project.configPath) !== undefined) return true
  const baseUrl = getBaseUrl(project.options)
  if (baseUrl !== undefined) {
    const first = specifier.split('/')[0] ?? ''
    const candidate = posix.resolve(toPosix(baseUrl), first)
    return project.fs.directoryExists(candidate) || project.fs.fileExists(candidate)
  }
  return false
}

function isInRepo(file: string, repoRoot: string): boolean {
  return file.startsWith(`${repoRoot}/`) && !file.includes('/node_modules/')
}

/**
 * Resolves an import specifier exactly as the compiler does. Non-TS files (CSS, SVG, …), which the compiler
 * does not resolve, are looked up relative to the importer, through `paths` or through `baseUrl`.
 */
export function resolveSpecifier(project: ResolverContext, repoRoot: string, containingFile: string, specifier: string, mode: ts.ResolutionMode): Resolution {
  const cleaned = specifier.split('?')[0]?.split('#')[0] ?? specifier
  const result = ts.resolveModuleName(cleaned, containingFile, project.options, project.resolutionHost, project.resolutionCache, undefined, mode)
  const resolved = result.resolvedModule
  if (resolved) {
    const file = toPosix(project.fs.realpath(resolved.resolvedFileName))
    return isInRepo(file, repoRoot) ? { kind: 'module', file } : { kind: 'external' }
  }
  const ext = posix.extname(cleaned)
  if (!TS_LIKE.has(ext)) {
    const candidates: string[] = []
    if (isRelative(cleaned)) candidates.push(posix.resolve(posix.dirname(containingFile), cleaned))
    candidates.push(...(pathMappingCandidates(cleaned, project.options, project.configPath) ?? []))
    const baseUrl = getBaseUrl(project.options)
    if (baseUrl !== undefined && !isRelative(cleaned)) candidates.push(posix.resolve(toPosix(baseUrl), cleaned))
    for (const candidate of candidates) {
      if (project.fs.fileExists(candidate)) {
        const file = toPosix(project.fs.realpath(candidate))
        return isInRepo(file, repoRoot) ? { kind: 'asset', file } : { kind: 'external' }
      }
    }
  }
  return isProjectSpecifier(cleaned, project) ? { kind: 'unresolved' } : { kind: 'external' }
}
