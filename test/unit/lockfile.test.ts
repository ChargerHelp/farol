import { describe, expect, it } from 'vitest'
import type { ManifestDiff } from '../../src/classify/dependencies.js'
import { lockfileReason } from '../../src/classify/lockfile.js'
import type { ChangedFile, FileStatus } from '../../src/git/types.js'

const lockfile = (path: string, status: FileStatus = 'modified'): ChangedFile => ({ path, status, added: [], removed: [], binary: false })

const withDependencyChange = (manifest: string): ManifestDiff => ({
  manifest,
  changes: [{ manifest, name: 'left-pad', section: 'dependencies', change: 'added', from: null, to: '^1.0.0', bump: null, direction: null, critical: false }],
  otherFields: [],
})

describe('lockfileReason', () => {
  it('a manifest in a directory that only starts like the lockfile directory does not explain it', () => {
    expect(lockfileReason(lockfile('apps/a/package-lock.json'), [], [withDependencyChange('apps/ab/package.json')]).code).toBe('lockfile-only-change')
  })

  it('a manifest below the lockfile directory explains it', () => {
    expect(lockfileReason(lockfile('apps/package-lock.json'), [], [withDependencyChange('apps/ab/package.json')]).code).toBe('lockfile-changed-elsewhere')
  })

  it("another project's dependency change does not explain a shared lockfile that was deleted, added or renamed", () => {
    for (const status of ['deleted', 'added', 'renamed'] as const) {
      const r = lockfileReason(lockfile('pnpm-lock.yaml', status), [], [withDependencyChange('apps/b/package.json')])
      expect(r.code).toBe('lockfile-only-change')
      expect(r.detail).toBe(`lockfile ${status}, and dependency changes in apps/b/package.json explain a modified lockfile only: resolved versions may differ`)
    }
  })
})
