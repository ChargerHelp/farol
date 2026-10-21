import { afterAll, describe, expect, it } from 'vitest'
import { OutputSchema } from '../../src/output/schema.js'
import { runCli } from '../helpers/cli.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

const repos: ScenarioRepo[] = []
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
})

describe('environment, infrastructure and CI files', () => {
  it('get their own role and reason, a section in the plan and a bounded weight in the score', () => {
    const s = createScenarioRepo('01-new-route')
    repos.push(s)
    s.repo.write('.github/workflows/ci.yml', 'on: push\n')
    s.repo.write('Dockerfile', 'FROM node:22\n')
    s.repo.write('.env.example', 'API_URL=\n')
    const head = s.repo.commit('infra')
    const r = runCli(['--cwd', s.repo.dir, 'analyze', '--base', s.base, '--head', head])
    expect(r.code).toBe(0)
    const o = OutputSchema.parse(JSON.parse(r.stdout))
    expect(o.files.filter((f) => f.role === 'infra').map((f) => f.path)).toEqual(['.env.example', '.github/workflows/ci.yml', 'Dockerfile'])
    expect(o.reasons.filter((x) => x.code === 'infra-file-changed')).toHaveLength(3)
    expect(o.risk.files.some((f) => f.path === 'Dockerfile')).toBe(false)
  })
})
