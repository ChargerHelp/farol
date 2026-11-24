import { compareStrings, sortedUnique } from '../output/order.js'
import type { ImportGraph } from '../project/graph.js'
import type { RouteEntry } from '../routes/types.js'
import { describeHits, reachFrom, routesReaching, type ReachIndex, type RouteHit } from './reach.js'
import { reason, type Reason } from './reasons.js'
import type { GeneratorInput } from './roles.js'

interface ReachContext {
  graph: ImportGraph
  index: ReachIndex
  existingRoutes: readonly RouteEntry[]
  /** Whether an unresolved import target is git-ignored generated code. */
  isGenerated: (repoPath: string) => boolean
}

/**
 * Existing routes a changed generator input reaches through its generated code: from the files that import the
 * git-ignored output, and from output files in the import graph (committed, or read from disk). Chains end at the input.
 */
export function generatorInputReach(path: string, input: GeneratorInput, ctx: ReachContext): { hits: RouteHit[]; reason: Reason } {
  const importers = ctx.graph.unresolved.filter((u) => u.target !== undefined && ctx.isGenerated(u.target) && input.feeds(u.target)).map((u) => u.file)
  const starts = sortedUnique([...importers, ...ctx.graph.nodes.filter((n) => input.feeds(n))])
  const code = input.files.join(', ')
  if (starts.length === 0) return { hits: [], reason: reason('existing-file-unreachable', `generator input of ${code}; nothing in the project imports that code`, path) }
  const best = new Map<string, RouteHit>()
  for (const start of starts) {
    for (const h of routesReaching(reachFrom(ctx.index, start), ctx.existingRoutes)) {
      const via = [...h.via, path]
      const prev = best.get(h.route.key)
      if (!prev || via.length < prev.via.length) best.set(h.route.key, { route: h.route, via })
    }
  }
  const hits = [...best.values()].sort((a, b) => compareStrings(a.route.path, b.route.path) || compareStrings(a.route.key, b.route.key))
  const through = `generator input of ${code}, used by ${starts.length} file(s)`
  if (hits.length === 0) return { hits, reason: reason('existing-file-unreachable', `${through}; no route reaches them`, path) }
  return { hits, reason: reason('generator-input-changed', `${through}; reached by ${hits.length} existing route(s): ${describeHits(hits)}`, path) }
}
