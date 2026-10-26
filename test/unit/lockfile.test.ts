import { describe, expect, it } from 'vitest'
import type { ManifestDiff } from '../../src/classify/dependencies.js'
import { lockfileReason } from '../../src/classify/lockfile.js'
import type { ChangedFile } from '../../src/git/types.js'

const lockfile = (path: string): ChangedFile => ({ path, status: 'modified', added: [], removed: [], binary: false })

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
})
