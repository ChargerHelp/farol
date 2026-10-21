import { describe, expect, it } from 'vitest'
import { reactRouterAdapter } from '../../src/routes/react-router/index.js'
import type { ModuleResolution, RouteTable } from '../../src/routes/types.js'

/** Resolver stub: `./x` and `@/x` → src/x.tsx, `missing` → unresolved, anything else → package. */
function resolve(specifier: string): ModuleResolution {
  if (specifier.includes('missing')) return { kind: 'unresolved' }
  if (specifier.startsWith('./') || specifier.startsWith('@/')) return { kind: 'module', file: `src/${specifier.replace(/^(\.\/|@\/)/, '')}.tsx` }
  return { kind: 'external', specifier }
}

function extract(code: string, modules: Record<string, string> = {}): RouteTable {
  return reactRouterAdapter.extract({ file: 'src/routes.tsx', code, files: [], resolve, read: (file) => modules[file] })
}

const keys = (t: RouteTable): string[][] => t.routes.map((r) => [r.key, r.path, r.entry ?? '-', r.layouts.join(',')])

describe('react-router adapter: object form', () => {
  it('concatenates paths, handles absolute children, pathless layouts and index routes', () => {
    const t = extract(`
      import { createHashRouter } from 'react-router'
      import Root from './Root'
      import Shell from './Shell'
      import { A, B } from './pages'
      export const router = createHashRouter([
        { path: '/app', Component: Root, children: [
          { element: <Shell />, children: [
            { path: 'a/', element: <A /> },
            { path: '/abs', element: <B /> },
          ] },
          { index: true, element: <A /> },
          { path: '*', element: null },
        ] },
      ])`)
    expect(t.dynamic).toEqual([])
    expect(keys(t)).toEqual([
      ['/app', '/app', 'src/Root.tsx', ''],
      ['/app > (index)', '/app', 'src/pages.tsx', 'src/Root.tsx'],
      ['/app > (layout:src/Shell.tsx)', '/app', 'src/Shell.tsx', 'src/Root.tsx'],
      ['/app > (layout:src/Shell.tsx) > /abs', '/abs', 'src/pages.tsx', 'src/Root.tsx,src/Shell.tsx'],
      ['/app > (layout:src/Shell.tsx) > a/', '/app/a', 'src/pages.tsx', 'src/Root.tsx,src/Shell.tsx'],
      ['/app > *', '/app/*', '-', 'src/Root.tsx'],
    ])
  })

  it('supports local arrays, React.lazy constants, lazy methods, lazy objects and wrappers', () => {
    const t = extract(`
      import { lazy, Suspense } from 'react'
      import { createMemoryRouter, Navigate } from 'react-router-dom'
      import Spinner from './Spinner'
      import RequireAuth from '@/RequireAuth'
      const Dashboard = lazy(() => import('./Dashboard'))
      const children = [
        { path: 'dash', element: <Suspense fallback={<Spinner />}><Dashboard /></Suspense> },
        { path: 'old', element: <Navigate to="/dash" replace /> },
        { path: 'm', async lazy() { const m = await import('./M'); return { Component: m.default } } },
        { path: 'o', lazy: { Component: async () => (await import('./O')).default } },
        { path: 'auth', element: <RequireAuth><Dashboard /></RequireAuth>, errorElement: <Spinner /> },
      ]
      const routes = [{ path: '/', children }]
      export default createMemoryRouter(routes)`)
    expect(t.dynamic).toEqual([])
    expect(t.routes.map((r) => [r.key, r.entry, r.modules.join(',')])).toEqual([
      ['/', null, ''],
      ['/ > auth', 'src/Dashboard.tsx', 'src/Dashboard.tsx,src/RequireAuth.tsx,src/Spinner.tsx'],
      ['/ > dash', 'src/Dashboard.tsx', 'package:react,src/Dashboard.tsx,src/Spinner.tsx'],
      ['/ > m', 'src/M.tsx', 'src/M.tsx'],
      ['/ > o', 'src/O.tsx', 'src/O.tsx'],
      ['/ > old', 'package:react-router-dom', 'package:react-router-dom'],
    ])
  })

  it('reads an exported route array and counts an array passed to the router only once', () => {
    const t = extract(`
      import Home from './Home'
      export const routes = [{ path: '/', element: <Home /> }]
      export const router = createBrowserRouter(routes)
      export const NAV = [{ label: 'x', href: '/' }]`)
    expect(keys(t)).toEqual([['/', '/', 'src/Home.tsx', '']])
  })

  it('turns every unsupported construct into a dynamic-route diagnostic', () => {
    const t = extract(`
      import { createBrowserRouter } from 'react-router-dom'
      import Home from './Home'
      import { extraRoutes } from './extra'
      import Ghost from 'missing'
      const PATHS = { home: '/home' }
      function Local() { return null }
      const base = '/b'
      export const router = createBrowserRouter([
        { path: getPath(), element: <Home /> },
        { path: base, element: <Home /> },
        { path: '/local', element: <Local /> },
        { path: '/ghost', element: <Ghost /> },
        { path: '/lazy', lazy: () => import(name) },
        { path: '/cond', element: flag ? <Home /> : null },
        { ...shared, path: '/spread' },
        { [key]: '/computed' },
        { path: '/index', index: isIndex },
        ...extraRoutes,
        extraRoutes[0],
        { path: '/kids', children: extraRoutes },
      ])`)
    expect(t.dynamic.map((d) => [d.line, d.detail])).toEqual([
      [10, 'computed route path "getPath()"'],
      [12, 'component Local is declared in the routes file; import it from its own module'],
      [13, 'cannot resolve import "missing"'],
      [14, 'lazy import() with a computed path'],
      [15, 'unsupported element value "flag ? <Home /> : null"'],
      [16, 'spread in route object "...shared"'],
      [17, 'computed property name in route object'],
      [18, 'computed index flag "isIndex"'],
      [19, 'cannot find the export extraRoutes of src/extra.tsx'],
      [20, 'unsupported route "extraRoutes[0]"'],
      [21, 'cannot find the export extraRoutes of src/extra.tsx'],
    ])
    // A path from a local string constant is supported.
    expect(t.routes.map((r) => r.path)).toEqual(['/b', '/kids'])
    expect(t.sources).toEqual(['src/routes.tsx'])
  })

  it('reports files without a route table and syntax errors', () => {
    expect(extract('export const x = 1').dynamic[0]?.detail).toMatch(/^no route table found/)
    expect(extract('export const = [').dynamic[0]?.detail).toMatch(/^syntax error/)
  })
})

describe('react-router adapter: route trees split across modules', () => {
  const modules = {
    'src/routes.consts.tsx': "export const SEGMENTS = { app: 'org', reports: 'reports' } as const\nexport const CATCH_ALL = '*'\n",
    'src/routes.modules.tsx': [
      "export const reportsPage = async () => ({ Component: (await import('./Reports')).Reports })",
      'let cache: Promise<unknown> | undefined',
      "const loadTabs = () => import('./Tabs').then((m) => ({ Component: m.Tabs }))",
      'export const tabs = () => (cache ??= loadTabs())',
    ].join('\n'),
    'src/routes.config.tsx': [
      "import { SEGMENTS } from './routes.consts'",
      "import { reportsPage, tabs } from './routes.modules'",
      "import { more } from './more'",
      'export const TREE = [',
      '  { path: SEGMENTS.reports, lazy: reportsPage, handle: { label: x } },',
      '  { path: `${SEGMENTS.reports}/tabs`, lazy: tabs },',
      '  ...more,',
      ']',
    ].join('\n'),
    'src/more.tsx': "export { MORE as more } from './more-impl'\n",
    'src/more-impl.tsx': "import Page from './Page'\nexport const MORE = [{ path: 'more', element: <Page /> }]\n",
  }

  it('follows imported constants, arrays, re-exports and lazy functions', () => {
    const t = extract(
      `
      import { createBrowserRouter } from 'react-router'
      import Layout from './Layout'
      import { TREE } from './routes.config'
      import { SEGMENTS, CATCH_ALL } from './routes.consts'
      export const router = createBrowserRouter([
        { path: \`\${SEGMENTS.app}/:id\`, element: <Layout />, children: [...TREE, { path: CATCH_ALL, element: <Layout /> }] },
      ])`,
      modules,
    )
    expect(t.dynamic).toEqual([])
    expect(t.routes.map((r) => [r.path, r.entry])).toEqual([
      ['/org/:id', 'src/Layout.tsx'],
      ['/org/:id/*', 'src/Layout.tsx'],
      ['/org/:id/more', 'src/Page.tsx'],
      ['/org/:id/reports', 'src/Reports.tsx'],
      ['/org/:id/reports/tabs', 'src/Tabs.tsx'],
    ])
    expect(t.sources).toEqual(['src/more-impl.tsx', 'src/more.tsx', 'src/routes.config.tsx', 'src/routes.consts.tsx', 'src/routes.modules.tsx', 'src/routes.tsx'])
  })

  it('reports syntax errors and unknown exports in the other modules', () => {
    const t = extract("import { TREE } from './routes.config'\nimport { X } from './routes.consts'\nexport const r = createBrowserRouter([...TREE, { path: X, element: null }])", {
      'src/routes.config.tsx': 'export const TREE = [',
      'src/routes.consts.tsx': 'export const Y = 1',
    })
    expect(t.dynamic.map((d) => [d.file, d.detail])).toEqual([
      ['src/routes.config.tsx', "syntax error: ']' expected."],
      ['src/routes.tsx', 'cannot find the export TREE of src/routes.config.tsx'],
      ['src/routes.tsx', 'computed route path "X"'],
    ])
  })
})

describe('react-router adapter: JSX form', () => {
  it('reads <Routes>/<Route> with nested routes, index and Component', () => {
    const t = extract(`
      import { Routes, Route } from 'react-router-dom'
      import Layout from './Layout'
      import Home from './Home'
      import Users from './Users'
      export function AppRoutes() {
        return (
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path={'users'} Component={Users}>
                <Route path=":id" lazy={() => import('./User')} />
              </Route>
            </Route>
            <>
              <Route path="/about" element={<Home />} />
            </>
          </Routes>
        )
      }`)
    expect(t.dynamic).toEqual([])
    expect(keys(t)).toEqual([
      ['/', '/', 'src/Layout.tsx', ''],
      ['/ > (index)', '/', 'src/Home.tsx', 'src/Layout.tsx'],
      ['/ > users', '/users', 'src/Users.tsx', 'src/Layout.tsx'],
      ['/ > users > :id', '/users/:id', 'src/User.tsx', 'src/Layout.tsx,src/Users.tsx'],
      ['/about', '/about', 'src/Home.tsx', ''],
    ])
  })

  it('reads createRoutesFromElements inside createBrowserRouter', () => {
    const t = extract(`
      import Home from './Home'
      export const router = createBrowserRouter(createRoutesFromElements(<Route path="/" element={<Home />} />))`)
    expect(keys(t)).toEqual([['/', '/', 'src/Home.tsx', '']])
  })

  it('flags .map, spreads and foreign elements inside JSX routes', () => {
    const t = extract(`
      import Home from './Home'
      export const el = (
        <Routes>
          {pages.map((p) => <Route key={p} path={p} element={<Home />} />)}
          <Route {...props} />
          <div />
          <Route path="ok" element={<Home>{render()}</Home>} />
        </Routes>
      )`)
    expect(t.dynamic.map((d) => d.detail)).toEqual([
      'routes generated in JSX: "{pages.map((p) => <Route key={p} path={p} element={<Home />} />)}"',
      'spread attributes on <Route>',
      'unexpected <div> among routes',
      'element content is computed: "{render()}"',
    ])
  })
})
