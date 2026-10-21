import { describe, expect, it } from 'vitest'
import { buildImportGraph } from '../../src/project/graph.js'
import { createReachIndex, reachFrom } from '../../src/classify/reach.js'
import { memoryProject, ROOT } from '../helpers/memory.js'

function graphOf(files: Record<string, string>, isOrigin: (p: string) => boolean = () => true) {
  return buildImportGraph(memoryProject(files, 'src/main.ts'), { repoRoot: ROOT, isOrigin })
}

describe('import graph', () => {
  it('creates one edge kind per import form', () => {
    const g = graphOf({
      'src/main.ts': [
        "import './side'",
        "import { a } from './a'",
        "import * as ns from './ns'",
        "import data from './data.json'",
        "import './style.css'",
        "import logo from '@/logo.svg?react'",
        "export { r } from './r'",
        "const lazy = () => import('./lazy')",
        "const req = require('./req')",
        'console.log(a, ns, data, logo, lazy, req)',
      ].join('\n'),
      'src/side.ts': 'export {}',
      'src/a.ts': 'export const a = 1',
      'src/ns.ts': 'export const n = 1',
      'src/data.json': '{"x":1}',
      'src/style.css': 'body{}',
      'src/logo.svg': '<svg/>',
      'src/r.ts': 'export const r = 1',
      'src/lazy.ts': 'export default 1',
      'src/req.ts': 'export = 1',
    })
    expect(g.edges.map((e) => `${e.kind} ${e.to}`)).toEqual([
      'side-effect src/side.ts',
      'static src/a.ts',
      'static src/data.json',
      'require src/req.ts',
      'namespace src/ns.ts',
      'reexport src/r.ts',
      'dynamic src/lazy.ts',
      'asset src/logo.svg',
      'asset src/style.css',
    ].sort((x, y) => ((x.split(' ')[1] ?? '') < (y.split(' ')[1] ?? '') ? -1 : 1)))
    expect(g.unresolved).toEqual([])
  })

  it('skips type-only imports and re-exports', () => {
    const g = graphOf({
      'src/main.ts': "import type { T } from './types'\nimport { type U } from './types2'\nimport { type V, w } from './mixed'\nexport type { X } from './x'\nexport { type Y } from './y'\nlet v: T | U | V | undefined\nconsole.log(v, w)",
      'src/types.ts': 'export type T = 1',
      'src/types2.ts': 'export type U = 1',
      'src/mixed.ts': 'export type V = 1\nexport const w = 1',
      'src/x.ts': 'export type X = 1',
      'src/y.ts': 'export type Y = 1',
    })
    expect(g.edges).toEqual([{ from: 'src/main.ts', to: 'src/mixed.ts', kind: 'static' }])
  })

  it('points named imports at the declaring module, not at the barrel', () => {
    const g = graphOf({
      'src/main.ts': "import { A, B, C } from './components'\nconsole.log(A, B, C)",
      'src/components/index.ts': "export { A } from './A'\nexport * from './more'\nimport C from './C'\nexport { C }",
      'src/components/A.ts': 'export const A = 1',
      'src/components/more.ts': "export { B } from './B'",
      'src/components/B.ts': 'export const B = 1',
      'src/components/C.ts': 'export default 1',
    })
    const fromMain = g.edges.filter((e) => e.from === 'src/main.ts').map((e) => `${e.kind} ${e.to}`)
    expect(fromMain).toEqual(['static src/components/A.ts', 'static src/components/B.ts', 'static src/components/C.ts', 'barrel src/components/index.ts'])
    expect(g.reexportOnly).toEqual(['src/components/more.ts'])
  })

  it('a change in A does not reach importers of B; a change in a re-export-only barrel does', () => {
    const g = graphOf({
      'src/main.ts': "import { B } from './components'\nconsole.log(B)",
      'src/components/index.ts': "export { A } from './A'\nexport * from './more'",
      'src/components/A.ts': 'export const A = 1',
      'src/components/more.ts': "export { B } from './B'",
      'src/components/B.ts': 'export const B = 1',
    })
    const index = createReachIndex(g)
    expect(reachFrom(index, 'src/components/A.ts').has('src/main.ts')).toBe(false)
    expect(reachFrom(index, 'src/components/B.ts').get('src/main.ts')?.dist).toBe(1)
    expect(reachFrom(index, 'src/components/index.ts').has('src/main.ts')).toBe(true)
    expect(reachFrom(index, 'src/components/more.ts').has('src/main.ts')).toBe(true)
  })

  it('reports unresolved and non-literal imports, but not packages', () => {
    const g = graphOf({
      'src/main.ts': "import 'react'\nimport { x } from './missing'\nimport y from '@/nope'\nconst m = 'a'\nimport(m)\nimport.meta.glob('./pages/*.tsx')\nconsole.log(x, y)",
    })
    expect(g.unresolved.map((u) => [u.specifier, u.line, u.reason])).toEqual([
      ['./missing', 2, 'not-found'],
      ['@/nope', 3, 'not-found'],
      ['m', 5, 'non-literal'],
      ["import.meta.glob('./pages/*.tsx')", 6, 'non-literal'],
    ])
  })

  it('does not take imports from non-origin files (tests, stories, excluded)', () => {
    const g = graphOf({ 'src/main.ts': "import './a'", 'src/a.test.ts': "import './a'", 'src/a.ts': 'export {}' }, (p) => !p.endsWith('.test.ts'))
    expect(g.edges).toEqual([{ from: 'src/main.ts', to: 'src/a.ts', kind: 'side-effect' }])
  })

  it('records syntax errors', () => {
    const g = graphOf({ 'src/main.ts': 'export const = 1' })
    expect(g.parseErrors).toEqual([{ file: 'src/main.ts', line: 1, message: 'Variable declaration expected.' }])
  })
})
