import { compareStrings, sortedUnique } from '../output/order.js'
import type { ImportGraph } from '../project/graph.js'
import type { RouteEntry } from '../routes/types.js'
import { describeHits, reachFrom, routesReaching, type ReachIndex, type RouteHit } from './reach.js'
import { reason, type Reason } from './reasons.js'
import type { GeneratedCode } from './roles.js'

interface ReachContext {
  graph: ImportGraph
  index: ReachIndex
  existingRoutes: readonly RouteEntry[]
  /** Whether an unresolved import target is git-ignored generated code. */
  isGenerated: (repoPath: string) => boolean
}

/**
 * Files that use the generated code, each with the shortest chain of files between it and that code: the importers of
 * the git-ignored output (type-only imports too: protobuf types of a .proto loaded at runtime), output files in the
 * import graph (committed, or read from disk), and the files that reach either through type-only imports or
 * re-exports (a file that re-exports Prisma types).
 */
function generatedUsers(code: GeneratedCode, ctx: ReachContext): Map<string, string[]> {
  const importers = [
    ...ctx.graph.unresolved.filter((u) => u.target !== undefined && ctx.isGenerated(u.target) && code.feeds(u.target)).map((u) => u.file),
    ...ctx.graph.typeImports.filter((t) => code.feeds(t.target)).map((t) => t.file),
  ]
  const users = new Map(sortedUnique([...importers, ...ctx.graph.nodes.filter((n) => code.feeds(n))]).map((f): [string, string[]] => [f, []]))
  const typeImporters = new Map<string, string[]>()
  for (const t of ctx.graph.typeImports) typeImporters.set(t.target, [...(typeImporters.get(t.target) ?? []), t.file])
  const queue = [...users]
  for (const [user, via] of queue) {
    for (const file of typeImporters.get(user) ?? []) {
      if (users.has(file)) continue
      const chain = [user, ...via]
      users.set(file, chain)
      queue.push([file, chain])
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
  const starts = [...users].sort(([a], [b]) => compareStrings(a, b))
  const of = `generator input of ${code.files.join(', ')}`
  if (starts.length === 0) return { hits: [], reason: reason('generator-input-changed', `${of}; no import of that code found (imports of a package name do not count): no route listed`, path) }
  const best = new Map<string, RouteHit>()
  for (const [start, chain] of starts) {
    for (const h of routesReaching(reachFrom(ctx.index, start), ctx.existingRoutes)) {
      const via = [...h.via, ...chain, path]
      const prev = best.get(h.route.key)
      if (!prev || via.length < prev.via.length) best.set(h.route.key, { route: h.route, via })
    }
  }
  const hits = [...best.values()].sort((a, b) => compareStrings(a.route.path, b.route.path) || compareStrings(a.route.key, b.route.key))
  const used = `${of}, used by ${starts.length} file(s)`
  return { hits, reason: reason('generator-input-changed', hits.length === 0 ? `${used}; no route reaches them` : `${used}; reached by ${hits.length} existing route(s): ${describeHits(hits)}`, path) }
}
