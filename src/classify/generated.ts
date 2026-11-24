import type { ChangedFile } from '../git/types.js'
import { compareStrings, sortedUnique } from '../output/order.js'
import type { ImportGraph } from '../project/graph.js'
import type { RouteEntry } from '../routes/types.js'
import { describeHits, reachFrom, routesReaching, type ReachIndex, type RouteHit } from './reach.js'
import { reason, type Reason } from './reasons.js'
import type { AnalysisRole, GeneratedCode } from './roles.js'

/** Roles whose files `classify` reports without reaching them. */
const NO_REACH: ReadonlySet<AnalysisRole> = new Set(['excluded', 'story', 'manifest', 'lockfile', 'global', 'infra', 'test'])

/** Whether a generator input was renamed to a path whose role skips reach (an excluded folder, a test): it is still an input. */
export function renamedInputSkipsReach(file: ChangedFile, role: AnalysisRole, generatorInputOf: ((...repoPaths: string[]) => GeneratedCode | undefined) | undefined): boolean {
  return file.status === 'renamed' && file.oldPath !== undefined && NO_REACH.has(role) && generatorInputOf?.(file.oldPath) !== undefined
}

interface ReachContext {
  graph: ImportGraph
  index: ReachIndex
  existingRoutes: readonly RouteEntry[]
  /** Whether an unresolved import target is git-ignored generated code. */
  isGenerated: (repoPath: string) => boolean
}

/**
 * Files that use the generated code, each with the files between it and that code: the importers of the git-ignored
 * output, output files in the import graph (committed, or read from disk), and the files that reach either through
 * type-only imports or re-exports (protobuf types of a .proto loaded at runtime, a file that re-exports Prisma types).
 */
function generatedUsers(code: GeneratedCode, ctx: ReachContext): Map<string, string[]> {
  const importers = ctx.graph.unresolved.filter((u) => u.target !== undefined && ctx.isGenerated(u.target) && code.feeds(u.target)).map((u) => u.file)
  const users = new Map(sortedUnique([...importers, ...ctx.graph.nodes.filter((n) => code.feeds(n))]).map((f): [string, string[]] => [f, []]))
  for (let grew = true; grew; ) {
    grew = false
    for (const t of ctx.graph.typeImports) {
      const next = users.get(t.target)
      const via = code.feeds(t.target) ? [] : next && [t.target, ...next]
      if (users.has(t.file) || via === undefined) continue
      users.set(t.file, via)
      grew = true
    }
  }
  return users
}

/**
 * Existing routes a changed generator input reaches through the code it generates (`generatedUsers`). Chains end at
 * the input. Every outcome is `generator-input-changed`.
 */
export function generatorInputReach(path: string, code: GeneratedCode, ctx: ReachContext): { hits: RouteHit[]; reason: Reason } {
  const users = generatedUsers(code, ctx)
  const starts = [...users.keys()].sort(compareStrings)
  const of = `generator input of ${code.files.join(', ')}`
  if (starts.length === 0) return { hits: [], reason: reason('generator-input-changed', `${of}; no import of that code found (imports of a package name do not count): no route listed`, path) }
  const best = new Map<string, RouteHit>()
  for (const start of starts) {
    for (const h of routesReaching(reachFrom(ctx.index, start), ctx.existingRoutes)) {
      const via = [...h.via, ...(users.get(start) ?? []), path]
      const prev = best.get(h.route.key)
      if (!prev || via.length < prev.via.length) best.set(h.route.key, { route: h.route, via })
    }
  }
  const hits = [...best.values()].sort((a, b) => compareStrings(a.route.path, b.route.path) || compareStrings(a.route.key, b.route.key))
  const used = `${of}, used by ${starts.length} file(s)`
  return { hits, reason: reason('generator-input-changed', hits.length === 0 ? `${used}; no route reaches them` : `${used}; reached by ${hits.length} existing route(s): ${describeHits(hits)}`, path) }
}
