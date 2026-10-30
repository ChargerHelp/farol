import { describe, expect, it } from 'vitest'
import { buildBackendTable } from '../../src/backend/entrypoints.js'
import { mergePath } from '../../src/backend/hono.js'
import { diffResolvers, resolverEntries } from '../../src/backend/resolvers.js'
import { memoryProject, ROOT } from '../helpers/memory.js'

function table(files: Record<string, string>) {
  return buildBackendTable({ project: memoryProject(files, 'src/main.ts'), repoRoot: ROOT, files: Object.keys(files), read: (f) => files[f], isOrigin: () => true, graphql: false, rest: true, context: {} })
}

const keys = (files: Record<string, string>): string[] => table(files).operations.map((o) => o.key)
const dynamic = (files: Record<string, string>): string[] => table(files).dynamic.map((d) => `${d.file}:${d.line} ${d.detail}`)

const items = `import { Hono } from 'hono'
export function createItems() {
  const routes = new Hono()
  routes.get('/', (c) => {
    return c.json([])
  })
  routes.get('/:id', (c) => c.json({}))
  return routes
}
`

describe('Hono mounts', () => {
  it('joins prefixes like Hono does', () => {
    expect([mergePath('/api', '/users'), mergePath('/api', '/'), mergePath('/', '/health'), mergePath('/', '/'), mergePath('/api/', '/x'), mergePath('/admin', '/*')]).toEqual(['/api/users', '/api', '/health', '/', '/api/x', '/admin/*'])
  })

  it('gives one entry per mount of a factory, with the full path', () => {
    const files = {
      'src/items.ts': items,
      'src/main.ts': `import { Hono } from 'hono'
import { createItems } from './items'
const app = new Hono()
app.route('/a', createItems())
app.route('/b', createItems()).route('/c', createItems())
app.get('/health', (c) => c.text('ok'))
`,
    }
    expect(keys(files)).toEqual(['GET /a', 'GET /a/:id', 'GET /b', 'GET /b/:id', 'GET /c', 'GET /c/:id', 'GET /health'])
    expect(dynamic(files)).toEqual([])
    expect(table(files).resolverKeys.get('GET /b/:id')).toEqual(new Set(['src/items.ts GET /:id']))
  })

  it('reads a root app received as a parameter (import type), through the callers', () => {
    const files = {
      'src/items.ts': items,
      'src/server.ts': `import { Hono } from 'hono'\nexport function createApp(): Hono {\n  const app = new Hono()\n  return app\n}\n`,
      'src/routes.ts': `import type { Hono as H } from 'hono'
import { createItems } from './items'
export function register(app: H<{ Bindings: {} }>) {
  app.route('/api', createItems())
}
`,
      'src/main.ts': `import { createApp } from './server'\nimport { register } from './routes'\nconst app = createApp()\nregister(app)\n`,
    }
    expect(keys(files)).toEqual(['GET /api', 'GET /api/:id'])
    expect(dynamic(files)).toEqual([])
  })

  it('reads an exported default sub-app and deduplicates the same mount twice', () => {
    const files = {
      'src/books.ts': `import { Hono } from 'hono'\nconst books = new Hono()\nbooks.get('/', (c) => c.json([]))\nexport default books\n`,
      'src/main.ts': `import { Hono } from 'hono'\nimport books from './books'\nconst app = new Hono()\napp.route('/books', books)\napp.route('/books', books)\n`,
    }
    expect(keys(files)).toEqual(['GET /books'])
    expect(table(files).dynamic).toEqual([])
  })

  it('keeps Express and Fastify paths as written', () => {
    expect(keys({ 'src/main.ts': `import express from 'express'\nconst app = express()\napp.get('/users', (req, res) => res.json([]))\n` })).toEqual(['GET /users'])
  })

  it('an unmounted factory with GET / does not merge with another app\'s GET /', () => {
    const files = {
      'src/items.ts': items,
      'src/main.ts': `import { Hono } from 'hono'\nconst app = new Hono()\napp.get('/', (c) => c.text('home'))\n`,
    }
    const t = table(files)
    expect(t.resolverKeys.get('GET /')).toEqual(new Set(['src/items.ts GET /', 'src/main.ts GET /']))
  })

  it.each([
    ['a non-literal prefix', `const PREFIX = '/x'\napp.route(PREFIX, createItems())`, 'src/main.ts:5 Hono route() prefix is not a string literal'],
    ['a factory that returns one of two apps', `function pick(flag: boolean) {\n  const a = new Hono()\n  const b = new Hono()\n  if (flag) return a\n  return b\n}\napp.route('/x', pick(true))`, 'src/main.ts:10 Hono route() target is not an app farol can follow'],
    ['a basePath() chain', `const v1 = app.basePath('/v1')\nv1.get('/x', (c) => c.text(''))`, 'src/main.ts:5 Hono app is not one farol can follow (basePath, alias or property)'],
    ['a mount target that is a parameter', `export function mount(sub: Hono) {\n  app.route('/x', sub)\n}`, 'src/main.ts:5 Hono route() target is a parameter: its apps come from the callers'],
    ['a handler on an app farol cannot follow', `const deps = { app }\ndeps.app.get('/x', (c) => c.text(''))`, 'src/main.ts:5 Hono app is not one farol can follow (basePath, alias or property)'],
  ])('%s is a dynamic route', (_name, code, expected) => {
    const files = { 'src/items.ts': items, 'src/main.ts': `import { Hono } from 'hono'\nimport { createItems } from './items'\nconst app = new Hono()\n${code}\n` }
    expect(dynamic(files)).toEqual([expected])
  })

  it('reads route(a, b) calls as mounts only in files that import hono', () => {
    const base = "import { client } from './client'\nexport function setup() {\n  client.ping()\n}\n"
    const head = "import { client } from './client'\nexport function setup() {\n  client.ping()\n  client.route('/a', 'b')\n}\n"
    const changes = diffResolvers(resolverEntries('src/setup.ts', base, new Map()), resolverEntries('src/setup.ts', head, new Map()))
    expect(changes.restChanged).toBe(true)
    expect(changes.addedMounts).toEqual([])
  })
})

