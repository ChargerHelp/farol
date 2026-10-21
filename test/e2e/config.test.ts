import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRepo, type TestRepo } from '../helpers/repo.js'
import { runCli } from '../helpers/cli.js'

describe('cli configuration errors', () => {
  let repo: TestRepo

  beforeAll(() => {
    repo = createRepo()
    repo.write('farol.config.json', '{"routes":{"file":""},"extra":1}')
    repo.write('broken.json', '{ nope')
    repo.commit('init')
  })
  afterAll(() => { repo.cleanup(); })

  it('exits 1 with a clear message for an invalid configuration', () => {
    const r = runCli(['--cwd', repo.dir, 'routes'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('invalid configuration in')
    expect(r.stderr).toContain('routes.file: routes.file must point to the file with the route table')
    expect(r.stderr).toContain('unknown key(s) "extra"')
  })

  it('exits 1 when the file is missing or not JSON', () => {
    expect(runCli(['--cwd', repo.dir, '--config', 'missing.json', 'routes']).stderr).toMatch(/configuration file not found at .*missing\.json; create it/)
    const r = runCli(['--cwd', repo.dir, '--config', 'broken.json', 'routes'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('is not valid JSON')
  })

  it('exits 1 for usage errors', () => {
    expect(runCli(['analyze']).code).toBe(1)
    expect(runCli(['nope']).code).toBe(1)
  })
})
