import { describe, expect, it } from 'vitest'
import { createReachIndex } from '../../src/classify/reach.js'
import { computeRisk } from '../../src/classify/risk.js'
import type { ImportGraph } from '../../src/project/graph.js'
import type { RouteEntry } from '../../src/routes/types.js'

// Layout L wraps pages A, B, C, D; every page imports util; only A imports a.
const edges: ImportGraph['edges'] = [
  ...['A', 'B', 'C', 'D'].map((p) => ({ from: `src/${p}.tsx`, to: 'src/util.ts', kind: 'static' as const })),
  { from: 'src/A.tsx', to: 'src/a.ts', kind: 'static' },
  { from: 'src/lib/x.ts', to: 'src/lonely.ts', kind: 'static' },
  ...Array.from({ length: 10 }, (_, i) => ({ from: `src/tool${i}.ts`, to: 'src/shared-tool.ts', kind: 'static' as const })),
]
const nodes = new Set(edges.flatMap((e) => [e.from, e.to]))
const graph: ImportGraph = { nodes: [...nodes], edges, unresolved: [], parseErrors: [], reexportOnly: [] }
const route = (key: string, entry: string, layouts: string[] = []): RouteEntry => ({ key, path: `/${key}`, index: false, entry, modules: [entry], layouts })
const routes = [route('l', 'src/L.tsx'), ...['A', 'B', 'C', 'D'].map((p) => route(`l > ${p}`, `src/${p}.tsx`, ['src/L.tsx']))]

function risk(files: { path: string; change: 'modified' | 'renamed' | 'deleted' | 'added' | 'additive' }[]) {
  return computeRisk({ index: createReachIndex(graph), nodes, existingRoutes: routes, hasChildren: (k) => k === 'l', files })
}

describe('risk', () => {
  it('measures who uses each file and ranks the riskiest first', () => {
    const r = risk([
      { path: 'src/a.ts', change: 'modified' },
      { path: 'src/util.ts', change: 'modified' },
      { path: 'src/lonely.ts', change: 'modified' },
      { path: 'src/shared-tool.ts', change: 'modified' },
    ])
    expect(r.totalPages).toBe(4)
    expect(r.files.map((f) => [f.path, f.level, f.pagesReached, f.directImporters, f.transitiveDependents])).toEqual([
      ['src/util.ts', 'high', 4, 4, 4],
      ['src/a.ts', 'medium', 1, 1, 1],
      ['src/shared-tool.ts', 'medium', 0, 10, 10],
      ['src/lonely.ts', 'low', 0, 1, 1],
    ])
    expect(r.files[0]?.centrality).toBe(Math.round((4 / (nodes.size - 1)) * 1000) / 1000)
  })

  it('additive changes are low, new files inside existing pages and deletions are medium', () => {
    const r = risk([
      { path: 'src/util.ts', change: 'additive' },
      { path: 'src/a.ts', change: 'added' },
      { path: 'src/gone.ts', change: 'deleted' },
    ])
    expect(r.files.map((f) => [f.path, f.level, f.why])).toEqual([
      ['src/a.ts', 'medium', 'new code already used by 1 existing page'],
      ['src/gone.ts', 'medium', 'deleted file: its former users cannot be measured on the head'],
      ['src/util.ts', 'low', 'additive change: nothing that existed changed'],
    ])
  })
})
