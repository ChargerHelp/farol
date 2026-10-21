import { compareStrings } from '../output/order.js'
import type { Output } from '../output/schema.js'
import type { Linker } from './links.js'

/** A route the PR changes: an existing route reached by changed files, or a new route. */
export interface ChangedRoute {
  key: string
  path: string
  kind: 'affected' | 'added'
  /** The route wraps other routes (layout, provider, error boundary); the others are pages. */
  hasChildren: boolean
  /** Changed files behind the change (the files at the end of the import chains), sorted. */
  files: string[]
  /** Import chains from the route's module to each changed file. */
  chains: string[][]
  /** Mermaid flowchart of the chains: route → modules → changed files. */
  mermaid: string
  /** Highest risk among the changed files behind this route. */
  risk: 'high' | 'medium' | 'low' | null
}

/** Risk of a changed file, as shown on its node. */
export interface NodeRisk {
  level: 'high' | 'medium' | 'low'
  pagesReached: number
  totalPages: number
  /** Unit of the counts: pages or operations. */
  unit?: string
}

// Bright borders on dark fills: the risk must stand out from the change color (modified/new) of the node.
const RISK_STROKE: Record<NodeRisk['level'], string> = { high: 'stroke:#ff2d2d,stroke-width:6px', medium: 'stroke:#ffd60a,stroke-width:4px', low: 'stroke-width:1px' }

/** Most chains drawn per route. */
export const MAX_DIAGRAM_CHAINS = 30

function label(text: string): string {
  return text.replaceAll('"', '#quot;').replaceAll('<', '#lt;').replaceAll('>', '#gt;')
}

/**
 * Mermaid source of one route: the route node, then every module on the chains, changed files highlighted
 * (new files and modified files in different colors), each module clickable to its diff or source on GitHub.
 */
export function routeMermaid(
  route: { key: string; path: string },
  chains: readonly string[][],
  status: ReadonlyMap<string, string>,
  links: Linker,
  shorten: (path: string) => string,
  risk: ReadonlyMap<string, NodeRisk> = new Map(),
): string {
  const ids = new Map<string, string>()
  const id = (path: string): string => {
    let value = ids.get(path)
    if (value === undefined) {
      value = `n${ids.size + 1}`
      ids.set(path, value)
    }
    return value
  }
  const edges = new Set<string>()
  const lines = ['flowchart LR', `  route(["${label(route.path)}"]):::route`]
  for (const chain of chains.slice(0, MAX_DIAGRAM_CHAINS)) {
    let previous = 'route'
    for (const path of chain) {
      const current = id(path)
      edges.add(`  ${previous} --> ${current}`)
      previous = current
    }
  }
  for (const [path, nodeId] of ids) {
    const state = status.get(path)
    const cls = state === 'added' ? 'added' : state === undefined ? 'module' : 'changed'
    const r = cls === 'module' ? undefined : risk.get(path)
    // Changed files carry their risk on a second line and in the border.
    const text = r ? `${label(shorten(path))}<br/><small>${r.level} risk · ${r.pagesReached}/${r.totalPages} ${r.unit ?? 'pages'}</small>` : label(shorten(path))
    lines.push(`  ${nodeId}["${text}"]:::${cls}`)
    if (r) lines.push(`  style ${nodeId} ${RISK_STROKE[r.level]}`)
  }
  lines.push(...[...edges])
  for (const [path, nodeId] of ids) {
    const url = links.file(path)
    if (url !== null) lines.push(`  click ${nodeId} href "${url}" _blank`)
  }
  lines.push(
    '  classDef route fill:#2457c5,stroke:#2457c5,color:#fff',
    '  classDef changed fill:#5c3317,stroke:#a8642a,color:#fff',
    '  classDef added fill:#14532d,stroke:#2f8f55,color:#fff',
    // Unchanged files are only on the path: almost transparent so the changes stand out.
    '  classDef module fill:transparent,stroke:#9aa4b1,stroke-dasharray:3 3,color:#8a94a3',
  )
  return lines.join('\n')
}

/** Every route the PR changes, affected existing routes first, each with its chains and diagram. */
export function changedRoutes(output: Output, links: Linker, shorten: (path: string) => string): ChangedRoute[] {
  const status = new Map<string, string>(output.files.map((f) => [f.path, f.status]))
  const risk = new Map(output.risk.files.map((f) => [f.path, { level: f.level, pagesReached: f.pagesReached, totalPages: output.risk.totalPages, unit: output.surface === 'backend' ? 'operations' : 'pages' }]))
  const order = { high: 0, medium: 1, low: 2 } as const
  const maxRisk = (files: readonly string[]): ChangedRoute['risk'] =>
    files.map((f) => risk.get(f)?.level).filter((l) => l !== undefined).sort((a, b) => order[a] - order[b])[0] ?? null
  const affected = output.routes.affected.map((r): ChangedRoute => {
    const chains = r.via.map((v) => v.chain)
    return { key: r.key, path: r.path, kind: 'affected', hasChildren: r.hasChildren, files: r.via.map((v) => v.file).sort(compareStrings), chains, mermaid: routeMermaid(r, chains, status, links, shorten, risk), risk: maxRisk(r.via.map((v) => v.file)) }
  })
  const added = output.routes.added.map((r): ChangedRoute => {
    const chains = r.entry === null ? [] : [[r.entry]]
    return { key: r.key, path: r.path, kind: 'added', hasChildren: r.hasChildren, files: r.entry !== null && status.has(r.entry) ? [r.entry] : [], chains, mermaid: routeMermaid(r, chains, status, links, shorten, risk), risk: maxRisk(r.entry === null ? [] : [r.entry]) }
  })
  return [...affected, ...added]
}
