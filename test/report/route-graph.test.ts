import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { renderHtml } from '../../src/report/html.js'
import { createLinker } from '../../src/report/links.js'
import { changedRoutes, routeMermaid, type ChangedRoute } from '../../src/report/route-graph.js'
import { buildRouteTree, type TreeNode } from '../../src/report/html-routes.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

function golden(scenario: string): Output {
  return OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, scenario, 'expected.json'), 'utf8')))
}

const none = { file: () => null, lines: () => null }

describe('route graphs', () => {
  it('lists affected and new routes with the changed files behind them', () => {
    const affected = changedRoutes(golden('05-shared-component'), none, (p) => p)
    expect(affected.map((r) => [r.kind, r.path, r.files])).toEqual([
      ['affected', '/', ['src/components/Card.tsx']],
      ['affected', '/products', ['src/components/Card.tsx']],
    ])
    const added = changedRoutes(golden('01-new-route'), none, (p) => p)
    expect(added.map((r) => [r.kind, r.path, r.chains])).toEqual([['added', '/reports', [['src/pages/ReportsPage.tsx']]]])
  })

  it('draws route → modules → changed files, highlighting and linking them', () => {
    const status = new Map([
      ['src/lib/a.ts', 'modified'],
      ['src/lib/new.ts', 'added'],
    ])
    const links = { file: (p: string) => `https://x/${p}`, lines: () => null }
    const chart = routeMermaid({ key: '/ > a', path: '/a "quoted"' }, [['src/pages/A.tsx', 'src/lib/a.ts'], ['src/pages/A.tsx', 'src/lib/new.ts']], status, links, (p) => p.replace('src/', ''))
    expect(chart.split('\n').slice(0, 9)).toEqual([
      'flowchart LR',
      '  route(["/a #quot;quoted#quot;"]):::route',
      '  n1["pages/A.tsx"]:::module',
      '  n2["lib/a.ts"]:::changed',
      '  n3["lib/new.ts"]:::added',
      '  route --> n1',
      '  n1 --> n2',
      '  n1 --> n3',
      '  click n1 href "https://x/src/pages/A.tsx" _blank',
    ])
  })

  it('shows the risk of changed files on their nodes and keeps unchanged files transparent', () => {
    const status = new Map([['src/lib/a.ts', 'modified']])
    const risk = new Map([['src/lib/a.ts', { level: 'high' as const, pagesReached: 9, totalPages: 12 }]])
    const chart = routeMermaid({ key: 'a', path: '/a' }, [['src/pages/A.tsx', 'src/lib/a.ts']], status, none, (p) => p, risk)
    expect(chart).toContain('n2["src/lib/a.ts<br/><small>high risk · 9/12 pages</small>"]:::changed')
    expect(chart).toContain('style n2 stroke:#ff2d2d,stroke-width:6px')
    expect(chart).toContain('classDef module fill:transparent')
  })

  it('renders risk filters, the legend and the highest risk per route', () => {
    const html = renderHtml(golden('05-shared-component'))
    expect(html).toContain('<div class="filters" id="risk-filters">')
    expect(html).toContain('<input type="checkbox" data-filter="level" value="high" checked> high')
    expect(html).toContain('<tr data-level="high" data-change="modified">')
    expect(html).toContain('<div class="legend">')
    expect(html).toMatch(/<details class="route" data-files="[^"]*"><summary[^>]*>.*<span class="chip high"/)
    expect(html).not.toContain('Import chains')
  })

  it('renders one collapsible row per changed route with its diagram source', () => {
    const o = golden('05-shared-component')
    const html = renderHtml({ ...o, repo: 'acme/shop', pr: 3 }, createLinker({ ...o, repo: 'acme/shop', pr: 3 }, { repo: 'acme/shop', pr: 3 }))
    // Each page appears in the list view and in the tree view.
    expect(html.match(/<details class="route" /g)).toHaveLength(4)
    expect(html).toContain('<label for="routes-view-tree">Tree (by module)</label>')
    expect(html).toContain('<pre class="mermaid">flowchart LR')
    expect(html).toContain('Pages with changes: <span id="routes-affected">2</span> affected, 0 new')
    // The reviewed-files filter lists the changed files behind the pages, with how many pages each one affects.
    expect(html).toContain('<label class="review-file"><input type="checkbox" data-file="src/components/Card.tsx">')
    expect(html).toContain('data-files="src/components/Card.tsx"')
    expect(html).not.toContain('Affected layouts and wrappers')
  })

  it('lists pages first and groups layout routes in a collapsed block', () => {
    const html = renderHtml(golden('04-child-of-modified-layout'))
    // The root route "/" renders AppLayout around every page: it is a layout, the four pages are listed first.
    expect(html).toContain('Pages with changes: <span id="routes-affected">4</span> affected, 1 new')
    expect(html).toContain('<details class="layouts"><summary>Affected layouts and wrappers (1)</summary>')
    expect(html.indexOf('<code class="route-path">/about</code>')).toBeLessThan(html.indexOf('<details class="layouts">'))
  })

  it('builds a module tree from URL segments, merging single-child segments without pages', () => {
    const page = (path: string): ChangedRoute => ({ key: path, path, kind: 'affected', hasChildren: false, files: [], chains: [], mermaid: '', risk: null })
    const tree = buildRouteTree([page('/org/:id/reports/overview'), page('/org/:id/reports/team/members'), page('/org/:id/reports/team/overview'), page('/org/:id'), page('/public/p/:token')])
    const shape = (n: TreeNode): unknown => ({ label: n.label, pages: n.pages.map((p) => p.path), children: n.children.map(shape) })
    expect(shape(tree)).toEqual({
      label: '/',
      pages: [],
      children: [
        {
          label: 'org/:id',
          pages: ['/org/:id'],
          children: [
            {
              label: 'reports',
              pages: [],
              children: [
                { label: 'overview', pages: ['/org/:id/reports/overview'], children: [] },
                { label: 'team', pages: [], children: [{ label: 'members', pages: ['/org/:id/reports/team/members'], children: [] }, { label: 'overview', pages: ['/org/:id/reports/team/overview'], children: [] }] },
              ],
            },
          ],
        },
        { label: 'public/p/:token', pages: ['/public/p/:token'], children: [] },
      ],
    })
  })
})
