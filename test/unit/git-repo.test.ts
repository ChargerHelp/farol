import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diffFiles, listFiles, listMerges, mergeBase, readFiles, resolveCommit, showFile } from '../../src/git/index.js'
import { createRepo, type TestRepo } from '../helpers/repo.js'

describe('git module on a real repository', () => {
  let repo: TestRepo
  let base: string
  let head: string

  beforeAll(() => {
    repo = createRepo()
    repo.write('src/keep.ts', 'export const keep = 1\n')
    repo.write('src/mod.ts', 'export const a = 1\nexport const b = 2\n')
    repo.write('src/gone.ts', 'export const gone = 1\n')
    repo.write('src/old-name.ts', 'export const moved = 1\nexport const more = 2\nexport const evenMore = 3\n')
    base = repo.commit('base')
    repo.git('checkout', '-q', '-b', 'feature')
    repo.write('src/mod.ts', 'export const a = 1\nexport const b = 3\nexport const c = 4\n')
    repo.write('src/new.ts', 'export const fresh = 1\n')
    repo.remove('src/gone.ts')
    repo.remove('src/old-name.ts')
    repo.write('src/new-name.ts', 'export const moved = 1\nexport const more = 2\nexport const evenMore = 3\n')
    head = repo.commit('head')
    // Advance main so the merge-base is not simply the tip of the base branch.
    repo.git('checkout', '-q', 'main')
    repo.write('src/keep.ts', 'export const keep = 2\n')
    repo.commit('main moves on')
    repo.git('checkout', '-q', 'feature')
  })

  afterAll(() => { repo.cleanup(); })

  it('computes the merge-base and resolves refs', async () => {
    expect(await mergeBase(repo.dir, 'main', 'feature')).toBe(base)
    expect(await resolveCommit(repo.dir, 'feature')).toBe(head)
    await expect(resolveCommit(repo.dir, 'nope')).rejects.toThrow(/not a commit/)
  })

  it('reports the four statuses with line numbers', async () => {
    const files = await diffFiles(repo.dir, base, head)
    expect(files.map((f) => [f.status, f.path, f.oldPath])).toEqual([
      ['deleted', 'src/gone.ts', undefined],
      ['modified', 'src/mod.ts', undefined],
      ['renamed', 'src/new-name.ts', 'src/old-name.ts'],
      ['added', 'src/new.ts', undefined],
    ])
    const mod = files.find((f) => f.path === 'src/mod.ts')
    expect(mod?.removed).toEqual([{ line: 2, text: 'export const b = 2' }])
    expect(mod?.added).toEqual([
      { line: 2, text: 'export const b = 3' },
      { line: 3, text: 'export const c = 4' },
    ])
    expect(files.find((f) => f.path === 'src/gone.ts')?.removed).toEqual([{ line: 1, text: 'export const gone = 1' }])
  })

  it('reads files at a ref, one by one and in batch', async () => {
    expect(await showFile(repo.dir, base, 'src/gone.ts')).toBe('export const gone = 1\n')
    expect(await showFile(repo.dir, head, 'src/gone.ts')).toBeNull()
    expect(await listFiles(repo.dir, head)).toEqual(['src/keep.ts', 'src/mod.ts', 'src/new-name.ts', 'src/new.ts'])
    const batch = await readFiles(repo.dir, head, ['src/new.ts', 'src/missing.ts', 'src/keep.ts'])
    expect([...batch.entries()]).toEqual([
      ['src/new.ts', 'export const fresh = 1\n'],
      ['src/keep.ts', 'export const keep = 1\n'],
    ])
  })

  it('lists merge commits by first parent', async () => {
    repo.git('checkout', '-q', 'main')
    repo.git('merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature')
    const merges = await listMerges(repo.dir, 'main', '2000-01-01', false)
    expect(merges).toHaveLength(1)
    expect(merges[0]?.subject).toBe('Merge feature')
    expect(merges[0]?.firstParent).toBe(repo.sha('HEAD^1'))
    // Every first-parent commit except the root, which has no parent to compare with.
    expect((await listMerges(repo.dir, 'main', '2000-01-01', true)).map((m) => m.subject)).toEqual(['main moves on', 'Merge feature'])
  })
})
