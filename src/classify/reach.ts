import { compareStrings } from '../output/order.js'
import type { ImportGraph } from '../project/graph.js'
import type { RouteEntry } from '../routes/types.js'

interface ReverseEdge {
  from: string
  kind: string
}

export interface ReachIndex {
  reverse: Map<string, ReverseEdge[]>
  reexportOnly: Set<string>
}

export function createReachIndex(graph: ImportGraph): ReachIndex {
  const reverse = new Map<string, ReverseEdge[]>()
  for (const edge of graph.edges) {
    const list = reverse.get(edge.to) ?? []
    list.push({ from: edge.from, kind: edge.kind })
    reverse.set(edge.to, list)
  }
  for (const list of reverse.values()) list.sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.kind, b.kind))
  return { reverse, reexportOnly: new Set(graph.reexportOnly) }
}

/** For every node that reaches the target: its distance and the next node on a shortest path to the target. */
export type ReachMap = Map<string, { dist: number; next: string | null }>

/**
 * Breadth-first search over reversed edges, from `target` to everything that imports it.
 * Barrel edges (importer → barrel it named-imported through) are only followed while the walk is still on the
 * changed barrel itself, or on barrels re-exporting a changed re-export-only module, so a change in component A
 * never reaches a route that imports only component B through the same barrel.
 */
export function reachFrom(index: ReachIndex, target: string): ReachMap {
  const result: ReachMap = new Map([[target, { dist: 0, next: null }]])
  const startIsReexportOnly = index.reexportOnly.has(target)
  type State = { node: string; barrelOk: boolean; dist: number }
  const seen = new Set<string>([`${target}\0true`])
  let frontier: State[] = [{ node: target, barrelOk: true, dist: 0 }]
  while (frontier.length > 0) {
    const next: State[] = []
    for (const state of frontier) {
      for (const edge of index.reverse.get(state.node) ?? []) {
        if (edge.kind === 'barrel' && !state.barrelOk) continue
        const barrelOk = state.barrelOk && startIsReexportOnly && edge.kind === 'reexport'
        const key = `${edge.from}\0${String(barrelOk)}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!result.has(edge.from)) result.set(edge.from, { dist: state.dist + 1, next: state.node })
        next.push({ node: edge.from, barrelOk, dist: state.dist + 1 })
      }
    }
    frontier = next
  }
  return result
}

/** Shortest import chain from `start` to the target of the reach map: [start, …, target]. */
export function chainFrom(reach: ReachMap, start: string): string[] {
  const chain = [start]
  let current = reach.get(start)
  while (current?.next != null) {
    chain.push(current.next)
    current = reach.get(current.next)
  }
  return chain
}

export interface RouteHit {
  route: RouteEntry
  /** Import chain from the route's anchor module (entry, wrapper or layout) to the target file. */
  via: string[]
}

/** Project modules that anchor a route, in tie-break order: entry, other modules, layouts from the closest. */
export function routeAnchors(route: RouteEntry): string[] {
  const anchors = [...(route.entry ? [route.entry] : []), ...route.modules.filter((m) => m !== route.entry), ...[...route.layouts].reverse()]
  return [...new Set(anchors)].filter((m) => !m.startsWith('package:'))
}

/** Routes whose entry, modules or layouts reach the target, each with one shortest chain. */
export function routesReaching(reach: ReachMap, routes: readonly RouteEntry[]): RouteHit[] {
  const hits: RouteHit[] = []
  for (const route of routes) {
    let best: string | undefined
    let bestDist = Infinity
    for (const anchor of routeAnchors(route)) {
      const r = reach.get(anchor)
      if (r && r.dist < bestDist) {
        best = anchor
        bestDist = r.dist
      }
    }
    if (best !== undefined) hits.push({ route, via: chainFrom(reach, best) })
  }
  return hits.sort((a, b) => compareStrings(a.route.path, b.route.path) || compareStrings(a.route.key, b.route.key))
}
