import { afterAll, describe, expect, it } from 'vitest'
import { OutputSchema } from '../../src/output/schema.js'
import { runCli } from '../helpers/cli.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

const repos: ScenarioRepo[] = []
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
})

describe('incremental mode and reviewers', () => {
  it('--since analyzes only the new commits; --reviewers lists the code owners', () => {
    const s = createScenarioRepo('05-shared-component')
    repos.push(s)
    const reviewed = s.head
    s.repo.write('CODEOWNERS', '/src/ @acme/web\n')
    s.repo.write('src/lib/extra.ts', 'export const extra = 1\n')
    const head = s.repo.commit('more work')
    const r = runCli(['analyze', '--base', s.base, '--head', head, '--since', reviewed, '--reviewers', '--pr', '7'], { cwd: s.repo.dir })
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    const o = OutputSchema.parse(JSON.parse(r.stdout))
    expect(o.incremental).toEqual({ since: reviewed })
    expect(o.mergeBase).toBe(reviewed)
    expect(o.files.map((f) => f.path)).toEqual(['CODEOWNERS', 'src/lib/extra.ts'])
    expect(o.reviewers).toEqual([{ name: '@acme/web', kind: 'codeowner', files: ['src/lib/extra.ts'], commits: 0 }])
  })
})
