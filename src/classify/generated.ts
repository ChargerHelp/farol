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
 * Existing routes a changed generator input reaches through the code it generates: from the files that import the
 * git-ignored output (type-only imports too: protobuf types of a .proto loaded at runtime), and from output files in
 * the import graph (committed, or read from disk). Chains end at the input. Every outcome is `generator-input-changed`.
 */
export function generatorInputReach(path: string, code: GeneratedCode, ctx: ReachContext): { hits: RouteHit[]; reason: Reason } {
  const importers = [...ctx.graph.unresolved, ...ctx.graph.typeOnlyUnresolved].filter((u) => u.target !== undefined && ctx.isGenerated(u.target) && code.feeds(u.target)).map((u) => u.file)
  const starts = sortedUnique([...importers, ...ctx.graph.nodes.filter((n) => code.feeds(n))])
  const of = `generator input of ${code.files.join(', ')}`
  if (starts.length === 0) return { hits: [], reason: reason('generator-input-changed', `${of}; no import of that code found (imports of a package name do not count): no route listed`, path) }
  const best = new Map<string, RouteHit>()
  for (const start of starts) {
    for (const h of routesReaching(reachFrom(ctx.index, start), ctx.existingRoutes)) {
      const via = [...h.via, path]
      const prev = best.get(h.route.key)
      if (!prev || via.length < prev.via.length) best.set(h.route.key, { route: h.route, via })
    }
  }
  const hits = [...best.values()].sort((a, b) => compareStrings(a.route.path, b.route.path) || compareStrings(a.route.key, b.route.key))
  const used = `${of}, used by ${starts.length} file(s)`
  return { hits, reason: reason('generator-input-changed', hits.length === 0 ? `${used}; no route reaches them` : `${used}; reached by ${hits.length} existing route(s): ${describeHits(hits)}`, path) }
}
