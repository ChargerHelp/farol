import { afterAll, describe, expect, it } from 'vitest'
import type { Output } from '../../src/output/schema.js'
import { analyzeVariant, type Change, edit } from '../helpers/variant.js'

const cleanups: (() => void)[] = []
afterAll(() => {
  for (const c of cleanups) c()
})

const ADMIN = 'src/http/admin.routes.ts'
const READ = 'src/http/read-resource.routes.ts'
const ISSUES = ['GET /admin/api/issues', 'GET /admin/api/issues/:id']

const pr = (change: Change, setup?: Change): Promise<Output> => analyzeVariant('b15-mount-arguments', cleanups, change, setup)
const affected = (o: Output): string[] => o.routes.affected.map((r) => r.key)

describe('reach through the argument types of Hono mounts', () => {
  it('a repository behind a port lists the endpoints of the mount that passes its use cases', async () => {
    const o = await pr((repo) => { edit(repo, 'src/infra/pg-issue-read-repository.ts', 'return `issue ${id}`', 'return `issue #${id}`') })
    expect(o.classification).toBe('touches-existing')
    expect(affected(o)).toEqual(ISSUES)
  })

  it('a factory that takes use case classes keeps one use case per endpoint', async () => {
    const o = await pr((repo) => { edit(repo, 'src/use-cases/list-prompts.ts', "return ['prompt']", "return ['prompt', 'draft']") })
    expect(affected(o)).toEqual(['GET /admin/api/prompts'])
  })

  it('an optional use case at the mount still lists the endpoints of that mount', async () => {
    const o = await pr(
      (repo) => { edit(repo, 'src/use-cases/list-issues.ts', 'this.repo.list(page)', 'this.repo.list(Math.max(page, 1))') },
      (repo) => {
        edit(repo, ADMIN, 'issues: { list: ListIssues; get: GetIssue }', 'issues: { list?: ListIssues; get: GetIssue }')
        edit(repo, READ, 'list: { execute(page: number): Promise<TList[]> }', 'list?: { execute(page: number): Promise<TList[]> }')
        edit(repo, READ, 'await useCases.list.execute(', 'await useCases.list?.execute(')
      },
    )
    expect(affected(o)).toEqual(ISSUES)
  })

  it('a factory member typed with a type-alias port keeps one use case per endpoint', async () => {
    const o = await pr(
      (repo) => { edit(repo, 'src/use-cases/list-prompts.ts', "return ['prompt']", "return ['prompt', 'draft']") },
      (repo) => {
        repo.write('src/ports/list-prompts.port.ts', 'export type ListPromptsPort = {\n  execute(): Promise<string[]>\n}\n')
        edit(repo, 'src/use-cases/list-prompts.ts', 'export class ListPrompts {', "import type { ListPromptsPort } from '../ports/list-prompts.port'\n\nexport class ListPrompts implements ListPromptsPort {")
        edit(repo, 'src/http/prompts.routes.ts', "import type { ListPrompts } from '../use-cases/list-prompts'", "import type { ListPromptsPort } from '../ports/list-prompts.port'")
        edit(repo, 'src/http/prompts.routes.ts', 'list: ListPrompts', 'list: ListPromptsPort')
        edit(repo, ADMIN, 'prompts: PromptUseCases', "prompts: { list: ListPrompts; get: GetPrompt }")
        edit(repo, ADMIN, "import type { ListSignals } from '../use-cases/list-signals'", "import type { GetPrompt } from '../use-cases/get-prompt'\nimport type { ListPrompts } from '../use-cases/list-prompts'\nimport type { ListSignals } from '../use-cases/list-signals'")
      },
    )
    expect(affected(o)).toEqual(['GET /admin/api/prompts'])
  })

  it('a use case class passed where the factory takes an inline type lists the endpoints of that mount', async () => {
    const o = await pr(
      (repo) => { edit(repo, 'src/use-cases/list-signals.ts', 'signal page ${page}', 'signal p${page}') },
      (repo) => {
        repo.write('src/http/status.routes.ts', "import { Hono } from 'hono'\n\nexport function createStatusRoutes(useCase: { execute(page: number): Promise<string[]> }): Hono {\n  const routes = new Hono()\n  routes.get('/', async (c) => c.json(await useCase.execute(1)))\n  return routes\n}\n")
        edit(repo, ADMIN, "import { createReadResourceRoutes } from './read-resource.routes'", "import { createReadResourceRoutes } from './read-resource.routes'\nimport { createStatusRoutes } from './status.routes'")
        edit(repo, ADMIN, "  routes.route('/prompts',", "  routes.route('/status', createStatusRoutes(useCases.signals.list))\n  routes.route('/prompts',")
      },
    )
    expect(affected(o)).toEqual(['GET /admin/api/signals', 'GET /admin/api/signals/:id', 'GET /admin/api/status'])
  })
})
