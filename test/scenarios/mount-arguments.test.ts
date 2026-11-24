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
})
