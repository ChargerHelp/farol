import { compareStrings } from '../output/order.js'
import type { RouteEntry } from '../routes/types.js'
import { reachFrom, routesReaching, type ReachIndex } from './reach.js'

export type RiskLevel = 'high' | 'medium' | 'low'

/** How central a changed file is in the import graph, and the risk level that follows. */
export interface FileRisk {
  path: string
  change: 'modified' | 'renamed' | 'deleted' | 'added' | 'additive'
  level: RiskLevel
  /** Project files that import it directly. */
  directImporters: number
  /** Project files that depend on it through any chain of imports (who would run the changed code). */
  transitiveDependents: number
  /** transitiveDependents / (project files − 1): 0 = nobody uses it, 1 = everything depends on it. */
  centrality: number
  /** Existing pages (routes without children) that reach it. */
  pagesReached: number
  /** Existing routes (pages and layouts) that reach it. */
  routesReached: number
  /** Why this level, in a few words. */
  why: string
}

export interface RiskInput {
  index: ReachIndex
  nodes: ReadonlySet<string>
  existingRoutes: readonly RouteEntry[]
  hasChildren: (key: string) => boolean
  /** Unit of the entry points in messages: page(s) for a frontend, operation(s) for a backend. */
  unit?: { one: string; many: string }
  /** Entry points affected per file when known from elsewhere (schema and resolver files, which nothing imports). */
  affectedOverride?: ReadonlyMap<string, number>
  /** Changed files that are part of the analysis (no tests, stories, excluded, global or dependency files). */
  files: readonly { path: string; change: FileRisk['change'] }[]
}

/** A change reaching at least this share of the existing pages (or this many pages) is high risk. */
export const HIGH_PAGE_SHARE = 0.5
export const HIGH_PAGES = 10
/** A change with this many transitive dependents is at least medium risk, even if no page reaches it. */
export const MEDIUM_DEPENDENTS = 10

const RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

function levelOf(change: FileRisk['change'], pages: number, totalPages: number, dependents: number, u: { one: string; many: string }): { level: RiskLevel; why: string } {
  if (change === 'additive') return { level: 'low', why: 'additive change: nothing that existed changed' }
  if (change === 'deleted') return { level: 'medium', why: 'deleted file: its former users cannot be measured on the head' }
  if (change === 'added') return pages > 0 ? { level: 'medium', why: `new code already used by ${pages} existing ${pages === 1 ? u.one : u.many}` } : { level: 'low', why: `new code not used by existing ${u.many}` }
  const share = totalPages === 0 ? 0 : pages / totalPages
  if (share >= HIGH_PAGE_SHARE || pages >= HIGH_PAGES) return { level: 'high', why: `used by ${pages} of ${totalPages} existing ${u.many}` }
  if (pages > 0) return { level: 'medium', why: `used by ${pages} of ${totalPages} existing ${u.many}` }
  if (dependents >= MEDIUM_DEPENDENTS) return { level: 'medium', why: `${dependents} files depend on it, no ${u.one} reaches it` }
  return { level: 'low', why: dependents === 0 ? 'nothing imports it' : `${dependents} file(s) depend on it, no ${u.one} reaches it` }
}

/** Centrality and risk of every changed file, riskiest first. Pure: everything comes from the graph and the routes. */
export function computeRisk(input: RiskInput): { totalPages: number; files: FileRisk[] } {
  const pages = input.existingRoutes.filter((r) => !input.hasChildren(r.key))
  const totalNodes = input.nodes.size
  const files = input.files.map(({ path, change }): FileRisk => {
    const inGraph = input.nodes.has(path)
    const reach = inGraph ? reachFrom(input.index, path) : undefined
    const direct = inGraph ? new Set((input.index.reverse.get(path) ?? []).filter((e) => e.kind !== 'barrel').map((e) => e.from)).size : 0
    const dependents = reach ? reach.size - 1 : 0
    const hits = reach ? routesReaching(reach, input.existingRoutes) : []
    const override = input.affectedOverride?.get(path)
    const pagesReached = override ?? hits.filter((h) => !input.hasChildren(h.route.key)).length
    const { level, why } = levelOf(change, pagesReached, pages.length, dependents, input.unit ?? { one: 'page', many: 'pages' })
    return {
      path,
      change,
      level,
      directImporters: direct,
      transitiveDependents: dependents,
      centrality: totalNodes > 1 ? Math.round((dependents / (totalNodes - 1)) * 1000) / 1000 : 0,
      pagesReached,
      routesReached: override ?? hits.length,
      why,
    }
  })
  files.sort((a, b) => RANK[a.level] - RANK[b.level] || b.pagesReached - a.pagesReached || b.transitiveDependents - a.transitiveDependents || compareStrings(a.path, b.path))
  return { totalPages: pages.length, files }
}
