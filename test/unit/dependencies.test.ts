import { describe, expect, it } from 'vitest'
import { compareSpecs, diffManifest, ManifestParseError, parseVersion } from '../../src/classify/dependencies.js'

describe('parseVersion', () => {
  it('reads the lowest version of plain semver ranges', () => {
    expect(parseVersion('^1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('~0.4')).toEqual({ major: 0, minor: 4, patch: 0 })
    expect(parseVersion('>=2.0.0')).toEqual({ major: 2, minor: 0, patch: 0 })
    expect(parseVersion('1.x')).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(parseVersion('npm:@scope/pkg@^3.1.0')).toEqual({ major: 3, minor: 1, patch: 0 })
  })

  it('returns null for anything that is not a plain range', () => {
    for (const spec of ['latest', '*', 'workspace:*', 'catalog:', 'github:a/b', 'https://x/y.tgz', '^1 || ^2', '1.0.0 - 2.0.0', 'file:../x']) expect(parseVersion(spec)).toBeNull()
  })
})

describe('compareSpecs', () => {
  it('classifies the bump and marks major as critical', () => {
    expect(compareSpecs('^18.2.0', '^19.0.0')).toEqual({ bump: 'major', direction: 'upgrade', critical: true })
    expect(compareSpecs('^3.0.0', '^3.6.0')).toEqual({ bump: 'minor', direction: 'upgrade', critical: false })
    expect(compareSpecs('3.22.4', '3.22.5')).toEqual({ bump: 'patch', direction: 'upgrade', critical: false })
    expect(compareSpecs('^1.2.3', '~1.2.3')).toEqual({ bump: 'range', direction: null, critical: false })
    expect(compareSpecs('^2.1.0', '^2.0.0')).toEqual({ bump: 'minor', direction: 'downgrade', critical: false, note: 'downgrade' })
  })

  it('treats breaking 0.x bumps and incomparable versions as critical', () => {
    expect(compareSpecs('^0.4.0', '^0.5.0')).toMatchObject({ bump: 'minor', critical: true })
    expect(compareSpecs('0.0.3', '0.0.4')).toMatchObject({ bump: 'patch', critical: true })
    expect(compareSpecs('^1.0.0', 'latest')).toMatchObject({ bump: 'unknown', critical: true })
    expect(compareSpecs('workspace:*', 'workspace:^')).toMatchObject({ bump: 'range', critical: false })
  })
})

describe('diffManifest', () => {
  const base = JSON.stringify({ name: 'app', scripts: { build: 'vite build' }, dependencies: { react: '^18.2.0', lodash: '^4.17.21', 'date-fns': '^3.0.0', moment: '^2.29.0' }, devDependencies: { vitest: '^3.0.0' } })
  const head = JSON.stringify({
    name: 'app',
    scripts: { build: 'vite build --mode prod' },
    dependencies: { react: '^19.0.0', 'date-fns': '^3.6.0', clsx: '^2.1.0' },
    devDependencies: { vitest: '^3.2.0', moment: '^2.29.0' },
  })

  it('lists added, removed, updated and moved packages, and other changed fields', () => {
    const d = diffManifest('package.json', base, head)
    expect(d.changes.map((c) => [c.name, c.change, c.bump, c.critical])).toEqual([
      ['clsx', 'added', null, false],
      ['date-fns', 'updated', 'minor', false],
      ['lodash', 'removed', null, true],
      ['moment', 'moved', null, true],
      ['react', 'updated', 'major', true],
      ['vitest', 'updated', 'minor', false],
    ])
    expect(d.changes.find((c) => c.name === 'moment')).toMatchObject({ fromSection: 'dependencies', section: 'devDependencies', note: 'no longer a dependencies entry: not installed for consumers/production' })
    expect(d.otherFields).toEqual(['scripts'])
  })

  it('handles added and deleted manifests and invalid JSON', () => {
    expect(diffManifest('p/package.json', null, base).changes.every((c) => c.change === 'added')).toBe(true)
    expect(diffManifest('p/package.json', base, null).changes.every((c) => c.change === 'removed' && c.critical)).toBe(true)
    expect(() => diffManifest('package.json', '{', head)).toThrow(ManifestParseError)
  })
})
