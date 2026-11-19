import { afterAll, describe, expect, it } from 'vitest'
import type { Output } from '../../src/output/schema.js'
import { analyzeVariant, type Change, edit } from '../helpers/variant.js'

const cleanups: (() => void)[] = []
afterAll(() => {
  for (const c of cleanups) c()
})

const PG = 'src/infra/pg-item-repository.ts'
const USE_CASE = 'src/use-cases/list-items.ts'
const changeFind: Change = (repo) => { edit(repo, PG, "return ['a', 'b']", "return ['a', 'b'].sort()") }

const pr = (change: Change, setup?: Change): Promise<Output> => analyzeVariant('b14-implements', cleanups, change, setup)
const affected = (o: Output): string[] => o.routes.affected.map((r) => r.key)

/** A port with `find`, a class in src/infra that implements it, and REST endpoints that take the port as a parameter. */
function withPort(name: string, routes: string): Change {
  const port = `I${name}`
  return (repo) => {
    repo.write(`src/ports/${name.toLowerCase()}.port.ts`, `export interface ${port} {\n  find(): Promise<string[]>\n}\n`)
    repo.write(`src/infra/pg-${name.toLowerCase()}.ts`, `import type { ${port} } from '../ports/${name.toLowerCase()}.port'\n\nexport class Pg${name} implements ${port} {\n  async find(): Promise<string[]> {\n    return ['x']\n  }\n}\n`)
    repo.write(`src/rest/${name.toLowerCase()}.ts`, `import type { ${port} } from '../ports/${name.toLowerCase()}.port'\n\nexport function register${name}(app: { get(path: string, handler: () => unknown): void }, repo: ${port}) {\n${routes}}\n`)
  }
}
const changePg = (name: string): Change => (repo) => { edit(repo, `src/infra/pg-${name.toLowerCase()}.ts`, "return ['x']", "return ['y']") }

describe('reach through interface implementations', () => {
  it('a use case that takes a Pick of the port still reaches the class that implements it', async () => {
    const o = await pr(changeFind, (repo) => {
      edit(repo, USE_CASE, 'repo: IItemRepository\n}', "repo: Pick<IItemRepository, 'find'>\n}")
      edit(repo, USE_CASE, 'private readonly repo: IItemRepository', "private readonly repo: Pick<IItemRepository, 'find'>")
    })
    expect(o.classification).toBe('touches-existing')
    expect(affected(o)).toEqual(['GET /items'])
  })

  it('a handler that calls the port itself lists only the endpoints that call it', async () => {
    const o = await pr(changePg('Models'), withPort('Models', "  app.get('/models', async () => repo.find())\n  app.get('/ping', async () => 'pong')\n"))
    expect(o.classification).toBe('touches-existing')
    expect(affected(o)).toEqual(['GET /models'])
  })

  it('a method with the same name on another interface does not link the two', async () => {
    const o = await pr(changeFind, withPort('Other', "  app.get('/other', async () => repo.find())\n"))
    expect(affected(o)).toEqual(['GET /items'])
  })

  it('a class that implements an alias of an interface that extends the port reaches callers of the port', async () => {
    const STORE = 'src/infra/pg-item-store.ts'
    const o = await pr(
      (repo) => { edit(repo, STORE, "return ['s']", "return ['t']") },
      (repo) => {
        repo.write('src/ports/item-store.port.ts', "import type { IItemRepository } from './item-repository.port'\n\nexport interface IItemStore extends IItemRepository {\n  save(): Promise<void>\n}\n\nexport type Store = IItemStore\n")
        repo.write(STORE, "import type { Store } from '../ports/item-store.port'\n\nexport class PgItemStore implements Store {\n  async find(): Promise<string[]> {\n    return ['s']\n  }\n\n  async save(): Promise<void> {}\n}\n")
      },
    )
    expect(affected(o)).toEqual(['GET /items'])
  })

  it('reach follows two implementations in a row', async () => {
    const REDIS = 'src/infra/redis-cache.ts'
    const o = await pr(
      (repo) => { edit(repo, REDIS, "return 'v'", "return 'w'") },
      (repo) => {
        repo.write('src/ports/cache.port.ts', 'export interface ICache {\n  read(key: string): Promise<string>\n}\n')
        repo.write(REDIS, "import type { ICache } from '../ports/cache.port'\n\nexport class RedisCache implements ICache {\n  async read(_key: string): Promise<string> {\n    return 'v'\n  }\n}\n")
        repo.write(PG, "import type { ICache } from '../ports/cache.port'\nimport type { IItemRepository } from '../ports/item-repository.port'\n\nexport class PgItemRepository implements IItemRepository {\n  constructor(private readonly cache: ICache) {}\n\n  async find(): Promise<string[]> {\n    return [await this.cache.read('items')]\n  }\n}\n")
        edit(repo, 'src/main.ts', 'new PgItemRepository()', 'new PgItemRepository(new RedisCache())')
        edit(repo, 'src/main.ts', "import { registerItems }", "import { RedisCache } from './infra/redis-cache'\nimport { registerItems }")
      },
    )
    expect(affected(o)).toEqual(['GET /items'])
  })
})
