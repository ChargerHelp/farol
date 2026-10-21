import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { OutputSchema } from '../../src/output/schema.js'
import { serializeOutput } from '../../src/output/write.js'
import { analyzeRepo } from '../helpers/analyze.js'
import { runCli } from '../helpers/cli.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

const repos: ScenarioRepo[] = []
const outDir = mkdtempSync(join(tmpdir(), 'farol-out-'))
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
  rmSync(outDir, { recursive: true, force: true })
})

function scenario(name: string): ScenarioRepo {
  const s = createScenarioRepo(name)
  repos.push(s)
  return s
}

describe('analyze through the built binary', () => {
  it('prints a schema-valid JSON on stdout and exits 0 whatever the class', () => {
    const s = scenario('05-shared-component')
    const r = runCli(['--cwd', s.repo.dir, 'analyze', '--base', 'main', '--head', 'feature'])
    expect(r.code).toBe(0)
    const output = OutputSchema.parse(JSON.parse(r.stdout))
    expect(output.classification).toBe('touches-existing')
    expect(output.head.sha).toBe(s.head)
    expect(output.mergeBase).toBe(s.base)
  })

  it('writes --out and exits 0 for unknown results too', () => {
    const s = scenario('11-routes-from-map')
    const out = join(outDir, 'unknown.json')
    const r = runCli(['--cwd', s.repo.dir, 'analyze', '--base', 'main', '--head', 'feature', '--out', out])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    expect(OutputSchema.parse(JSON.parse(readFileSync(out, 'utf8'))).classification).toBe('unknown')
  })

  it('on failure still writes an unknown JSON with the error and exits 2', () => {
    const s = scenario('05-shared-component')
    const out = join(outDir, 'failed.json')
    const r = runCli(['--cwd', s.repo.dir, 'analyze', '--base', 'main', '--head', 'does-not-exist', '--out', out])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('analysis failed: ref "does-not-exist" is not a commit in this repository')
    const output = OutputSchema.parse(JSON.parse(readFileSync(out, 'utf8')))
    expect(output.classification).toBe('unknown')
    expect(output.reasons[0]?.code).toBe('analysis-error')
    expect(output.diagnostics.error).toContain('does-not-exist')
  })

  it('reports the repository from GITHUB_REPOSITORY', () => {
    const s = scenario('18-disconnected-file')
    const r = runCli(['--cwd', s.repo.dir, 'analyze', '--base', 'main', '--head', 'feature'], { env: { GITHUB_REPOSITORY: 'acme/shop' } })
    expect((JSON.parse(r.stdout) as { repo: string }).repo).toBe('acme/shop')
  })
})

describe('determinism', () => {
  it('produces byte-identical output for the same input', async () => {
    const s = scenario('13-file-renamed')
    const first = serializeOutput((await analyzeRepo(s.repo)).output)
    const second = serializeOutput((await analyzeRepo(s.repo)).output)
    expect(second).toBe(first)
  })
})
