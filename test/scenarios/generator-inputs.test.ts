import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadContext } from '../../src/cli/context.js'
import { runAnalyze } from '../../src/cli/analyze.js'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { analyzeRepo, FIXED_DATE } from '../helpers/analyze.js'
import { BASE_API_DIR, BASE_APP_DIR, createRepo, FIXTURES_DIR, type TestRepo } from '../helpers/repo.js'
import { analyzeVariant, edit, type Change } from '../helpers/variant.js'

const cleanups: (() => void)[] = []
afterAll(() => {
  for (const c of cleanups) c()
})

const SCENARIO = 'b15-generator-input'
const SCHEMA = 'prisma/schema.prisma'
const changeSchema = (r: TestRepo): void => { edit(r, SCHEMA, '  amount Int', '  amount Int\n  currency String') }
const codesOf = (o: Output, file: string): string[] => o.reasons.filter((r) => r.file === file).map((r) => r.code)
const affectedKeys = (o: Output): string[] => o.routes.affected.map((r) => r.key)
type Config = Record<string, unknown>
const setConfig = (r: TestRepo, file: string, patch: (c: Config) => Config): void => { r.write(file, JSON.stringify(patch(JSON.parse(r.read(file)) as Config), null, 2)) }
const withPrismaInputs: Change = (r) => { setConfig(r, 'farol.config.json', (c) => ({ ...c, generated: [{ files: 'src/generated/**', from: ['prisma/*.prisma'] }] })) }

async function analyzeIn(repo: TestRepo, project: string): Promise<Output> {
  const ctx = await loadContext({ config: 'farol.config.json', cwd: join(repo.dir, project), verbose: false })
  const { output } = await runAnalyze(ctx, { base: 'main', head: 'feature' }, { now: () => FIXED_DATE, clock: () => 0, env: {} })
  OutputSchema.parse(output)
  return output
}

describe('generator inputs (generated[].from)', () => {
  it('a proto input above the project reaches the importers of the generated code', async () => {
    const repo = createRepo()
    cleanups.push(() => { repo.cleanup(); })
    cpSync(BASE_API_DIR, join(repo.dir, 'services/api'), { recursive: true })
    cpSync(join(FIXTURES_DIR, SCENARIO, 'base'), join(repo.dir, 'services/api'), { recursive: true })
    setConfig(repo, 'services/api/farol.config.json', (c) => ({ ...c, generated: [{ files: 'src/generated/**', from: ['../../schemas/protobuf/**/*.proto'] }] }))
    repo.write('schemas/protobuf/payment.proto', 'syntax = "proto3";\nmessage Payment { string id = 1; }\n')
    repo.commit('base')
    repo.git('checkout', '-q', '-b', 'feature')
    repo.write('schemas/protobuf/payment.proto', 'syntax = "proto3";\nmessage Payment { string id = 1; int64 amount = 2; }\n')
    repo.commit('feature')
    const o = await analyzeIn(repo, 'services/api')
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(o.files.map((f) => [f.path, f.role])).toEqual([['schemas/protobuf/payment.proto', 'source']])
    expect(codesOf(o, 'schemas/protobuf/payment.proto')).toEqual(['generator-input-changed'])
  })

  it('an input whose generated code nothing in the project imports is still touches-existing', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => { edit(r, 'src/rest/stripe.ts', "'../generated/prisma/client.js'", "'@prisma/client'") })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual([])
    expect(o.reasons.filter((r) => r.file === SCHEMA).map((r) => [r.code, r.detail])).toEqual([
      ['generator-input-changed', 'generator input of src/generated/**; no import of that code found (imports of a package name do not count): no route listed'],
    ])
  })

  it('a type-only importer of the generated code counts (protobuf types loaded at runtime)', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      r.write('src/rest/stripe.ts', "import type { Payment } from '../generated/prisma/models.js'\n\nexport async function handleStripe(request: { body: Payment }) {\n  return { received: Boolean(request.body) }\n}\n")
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, SCHEMA)).toEqual(['generator-input-changed'])
  })

  it('committed generated code (a file of the import graph) is reached through its importers', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => { r.write('src/generated/prisma/client.ts', 'export const Prisma = { PrismaClientKnownRequestError: Error }\n') })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, SCHEMA)).toEqual(['generator-input-changed'])
  })

  it('a deleted input lists the endpoints behind the importers', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, (r) => { r.remove(SCHEMA) })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, SCHEMA).sort()).toEqual(['existing-file-deleted', 'generator-input-changed'])
  })

  it('an added input reaches the importers of the generated code', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, (r) => { r.write('prisma/payment.prisma', 'model Refund {\n  id String @id\n}\n') }, withPrismaInputs)
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, 'prisma/payment.prisma')).toEqual(['generator-input-changed'])
  })

  it('a renamed input reaches the importers of the generated code', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, (r) => {
      r.write('prisma/main.prisma', r.read(SCHEMA))
      r.remove(SCHEMA)
    }, withPrismaInputs)
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, 'prisma/main.prisma').sort()).toEqual(['existing-file-renamed', 'generator-input-changed'])
  })

  it('an input whose importers no route reaches is still touches-existing', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      r.write('src/lib/payments.ts', "import { Prisma } from '../generated/prisma/client.js'\n\nexport const known = Prisma\n")
      edit(r, 'src/rest/stripe.ts', "'../generated/prisma/client.js'", "'@prisma/client'")
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual([])
    expect(o.reasons.filter((r) => r.file === SCHEMA).map((r) => [r.code, r.detail])).toEqual([
      ['generator-input-changed', 'generator input of src/generated/**, used by 1 file(s); no route reaches them'],
    ])
  })

  it('a rename out of the input globs still reaches the importers', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, (r) => {
      r.write('db/schema.prisma', r.read(SCHEMA))
      r.remove(SCHEMA)
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, 'db/schema.prisma').sort()).toEqual(['existing-file-renamed', 'generator-input-changed'])
  })

  it('a type-only importer of committed generated code counts', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      r.write('src/generated/prisma/models.ts', 'export interface Payment { id: string }\n')
      r.write('src/rest/stripe.ts', "import type { Payment } from '../generated/prisma/models.js'\n\nexport async function handleStripe(request: { body: Payment }) {\n  return { received: Boolean(request.body) }\n}\n")
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, SCHEMA)).toEqual(['generator-input-changed'])
  })

  it('a type-only re-export of the generated code counts', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      r.write('src/db/types.ts', "export type { Payment } from '../generated/prisma/models.js'\nexport const PAYMENT = 'payment'\n")
      r.write('src/rest/stripe.ts', "import { PAYMENT } from '../db/types.js'\n\nexport async function handleStripe(request: { body: unknown }) {\n  return { received: Boolean(request.body), kind: PAYMENT }\n}\n")
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, SCHEMA)).toEqual(['generator-input-changed'])
  })

  it('a type-only importer of a file that re-exports generated types counts', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      r.write('src/db/types.ts', "export type { Payment } from '../generated/prisma/models.js'\n")
      r.write('src/rest/stripe.ts', "import type { Payment } from '../db/types.js'\n\nexport async function handleStripe(request: { body: Payment }) {\n  return { received: Boolean(request.body) }\n}\n")
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, SCHEMA)).toEqual(['generator-input-changed'])
  })

  it.each([
    ['an import type equals require', "import type Models = require('../generated/prisma/models.js')\n\nexport async function handleStripe(request: { body: Models.Payment }) {"],
    ['an inline import type', "export async function handleStripe(request: { body: import('../generated/prisma/models.js').Payment }) {"],
  ])('a user of the generated types through %s counts', async (_form, head) => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      r.write('src/rest/stripe.ts', `${head}\n  return { received: Boolean(request.body) }\n}\n`)
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, SCHEMA)).toEqual(['generator-input-changed'])
  })

  it('the chain through type-only imports is the shortest one', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      r.write('src/a/q.ts', "export type { Payment } from '../generated/prisma/models.js'\n")
      r.write('src/a/p.ts', "export type { Payment } from './q.js'\n")
      r.write('src/z/r.ts', "export type { Payment } from '../generated/prisma/models.js'\n")
      r.write('src/rest/stripe.ts', "import type { Payment } from '../a/p.js'\nimport type { Payment as P } from '../z/r.js'\n\nexport async function handleStripe(request: { body: Payment | P }) {\n  return { received: Boolean(request.body) }\n}\n")
    })
    expect(o.routes.affected.map((r) => r.via.map((v) => v.chain))).toEqual([[['src/rest/stripe.ts', 'src/z/r.ts', SCHEMA]]])
  })

  it('a rename into an excluded folder still reaches the importers', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, (r) => {
      r.write('legacy/schema.prisma', r.read(SCHEMA))
      r.remove(SCHEMA)
    }, (r) => { setConfig(r, 'farol.config.json', (c) => ({ ...c, exclude: ['legacy/**'] })) })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(codesOf(o, 'legacy/schema.prisma').sort()).toEqual(['existing-file-renamed', 'file-excluded', 'generator-input-changed'])
  })

  it('a rename from one generator input to another reaches the importers of both', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, (r) => {
      r.write('proto/schema.prisma', r.read(SCHEMA))
      r.remove(SCHEMA)
    }, (r) => {
      setConfig(r, 'farol.config.json', (c) => ({ ...c, generated: [{ files: 'src/generated/prisma/**', from: ['prisma/**'] }, { files: 'src/generated/proto/**', from: ['proto/**'] }] }))
      edit(r, 'src/services/users.ts', 'export function getUser', "import { User } from '../generated/proto/user.js'\n\nexport const USER = User\n\nexport function getUser")
    })
    expect(o.classification).toBe('touches-existing')
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe', 'Query.me'])
    expect(codesOf(o, 'proto/schema.prisma').sort()).toEqual(['existing-file-renamed', 'generator-input-changed'])
  })

  it('an input that is also a global file makes the PR global', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, changeSchema, (r) => {
      setConfig(r, 'farol.config.json', (c) => {
        const roles = c.roles as { global: string[] }
        return { ...c, roles: { ...roles, global: [...roles.global, SCHEMA] } }
      })
    })
    expect(o.classification).toBe('global')
    expect(codesOf(o, SCHEMA)).toEqual(['global-file-changed'])
  })

  it('a PR that changes the input and an importer reports each once', async () => {
    const o = await analyzeVariant(SCENARIO, cleanups, (r) => {
      changeSchema(r)
      edit(r, 'src/rest/stripe.ts', 'received: Boolean(request.body)', 'received: request.body !== undefined')
    })
    expect(affectedKeys(o)).toEqual(['POST /webhooks/stripe'])
    expect(o.reasons.map((r) => [r.code, r.file])).toEqual([
      ['existing-file-modified', 'src/rest/stripe.ts'],
      ['generator-input-changed', SCHEMA],
    ])
  })

  it('a frontend schema input reaches the pages that import the generated code', async () => {
    const repo = createRepo()
    cleanups.push(() => { repo.cleanup(); })
    repo.overlay(BASE_APP_DIR)
    setConfig(repo, 'farol.config.json', (c) => ({ ...c, generated: [{ files: 'src/generated/**', from: ['schema.graphql'] }] }))
    repo.write('schema.graphql', 'type Query { about: String }\n')
    edit(repo, 'src/pages/AboutPage.tsx', "import { Button } from '@/components'", "import { Button } from '@/components'\nimport { AboutDocument } from '../generated/graphql'")
    edit(repo, 'src/pages/AboutPage.tsx', '<p>About us</p>', '<p>About us {String(AboutDocument)}</p>')
    repo.commit('base')
    repo.git('checkout', '-q', '-b', 'feature')
    repo.write('schema.graphql', 'type Query { about: String\n  team: [String] }\n')
    repo.commit('feature')
    const { output: o } = await analyzeRepo(repo)
    expect(o.classification).toBe('touches-existing')
    expect(o.routes.affected.map((r) => r.path)).toEqual(['/about'])
    expect(codesOf(o, 'schema.graphql')).toEqual(['generator-input-changed'])
  })
})
