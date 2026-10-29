import { posix } from 'node:path'
import picomatch from 'picomatch'
import type { Config } from '../config/schema.js'

export type Role = 'global' | 'routes' | 'test' | 'story' | 'infra' | 'barrel' | 'i18n' | 'source'
/** A file matched by `exclude` (and not a test or story) is left out of the analysis. */
export type FileRole = Role | 'excluded'

/** Roles the analysis assigns on top of the configuration: package manifests and lockfiles of the project. */
export type AnalysisRole = FileRole | 'manifest' | 'lockfile' | 'schema' | 'resolvers'

export type RoleMatcher = (projectPath: string) => FileRole

/** Extensions of source code: such files are never infrastructure, wherever they live. */
const SOURCE_CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|go|py|graphql|gql)$/

/** Whether a repo-relative path is an environment, infrastructure or CI file. */
export function createInfraMatcher(config: Config): (repoPath: string) => boolean {
  const match = matcher(config.roles.infra)
  return (repoPath) => !SOURCE_CODE.test(repoPath) && match(repoPath)
}

function matcher(globs: readonly string[]): (path: string) => boolean {
  if (globs.length === 0) return () => false
  return picomatch([...globs], { dot: true })
}

/**
 * Builds the role function for project-relative paths. Precedence: global, routes, test, story, infra, barrel, i18n,
 * source (infra globs are matched against repo-relative paths by createRepoRoleOf).
 * `exclude` only removes files whose role would be barrel, i18n or source: globals and the routes file always count,
 * and tests/stories keep their role so they can be reported.
 */
export function createRoleMatcher(config: Config): RoleMatcher {
  const isGlobal = matcher(config.roles.global)
  const isTest = matcher(config.roles.test)
  const isStory = matcher(config.roles.story)
  const isBarrel = matcher(config.roles.barrel)
  const isI18n = matcher(config.roles.i18n)
  const isExcluded = matcher(config.exclude)
  const routesFile = normalizeProjectPath(config.routes.file)
  const isExtraRoutes = matcher(config.routes.extraFiles)
  return (path) => {
    if (isGlobal(path)) return 'global'
    if (path === routesFile || isExtraRoutes(path)) return 'routes'
    if (isTest(path)) return 'test'
    if (isStory(path)) return 'story'
    if (isExcluded(path)) return 'excluded'
    if (isBarrel(path)) return 'barrel'
    if (isI18n(path)) return 'i18n'
    return 'source'
  }
}

/** `./src//a.ts` → `src/a.ts`. */
export function normalizeProjectPath(path: string): string {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/**
 * Whether an import target (repo-relative, as written) is generated code that git ignores: inside the project, matched
 * by a `generated` glob on its project-relative path, and in a folder without a file of the head commit. A missing
 * target next to committed files (a typo in an import of real code) stays an unresolved import.
 */
export function createGeneratedMatcher(globs: readonly string[], projectPrefix: string, headFiles: readonly string[]): (repoPath: string) => boolean {
  if (globs.length === 0) return () => false
  const match = matcher(globs)
  const committedFolders = new Set(headFiles.map((f) => posix.dirname(f)))
  return (repoPath) => {
    if (projectPrefix !== '' && !repoPath.startsWith(`${projectPrefix}/`)) return false
    const projectPath = projectPrefix === '' ? repoPath : repoPath.slice(projectPrefix.length + 1)
    return match(projectPath) && !committedFolders.has(posix.dirname(repoPath))
  }
}

/** Matcher for "ignore" globs: a file is ignored when its project-relative or repo-relative path matches. */
export function createIgnoreMatcher(globs: readonly string[]): (projectPath: string, repoPath: string) => boolean {
  const match = matcher(globs)
  return (projectPath, repoPath) => match(projectPath) || match(repoPath)
}
