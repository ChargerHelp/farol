import { describe, expect, it } from 'vitest'
import { diffGoMod, goBump, parseGoMod } from '../../src/golang/gomod.js'

const BASE = `module example.com/app

go 1.22

require (
	github.com/go-chi/chi/v5 v5.0.12
	github.com/google/uuid v1.6.0
	golang.org/x/sync v0.7.0 // indirect
	github.com/old/thing v1.2.0
)

require github.com/lib/pq v1.10.9 // pinned
`

describe('go.mod', () => {
  it('reads requirements (direct and indirect) and other directives', () => {
    const mod = parseGoMod(BASE)
    expect(mod.require.get('golang.org/x/sync')).toEqual({ version: 'v0.7.0', indirect: true })
    expect(mod.require.get('github.com/lib/pq')).toEqual({ version: 'v1.10.9', indirect: false })
    expect(mod.other.get('go')).toEqual(['1.22'])
  })

  it('classifies bumps like semver, with pre-v1 minors as major and pseudo-versions as unknown', () => {
    expect(goBump('v1.2.3', 'v1.2.4')).toEqual({ bump: 'patch', direction: 'upgrade' })
    expect(goBump('v1.2.3', 'v1.3.0')).toEqual({ bump: 'minor', direction: 'upgrade' })
    expect(goBump('v0.7.0', 'v0.8.0')).toEqual({ bump: 'major', direction: 'upgrade' })
    expect(goBump('v1.3.0', 'v1.2.9')).toEqual({ bump: 'minor', direction: 'downgrade' })
    expect(goBump('v0.0.0-20240101000000-aaaaaaaaaaaa', 'v0.0.0-20240201000000-bbbbbbbbbbbb').bump).toBe('unknown')
  })

  it('marks removals, majors and downgrades of direct requirements as critical', () => {
    const head = BASE.replace('github.com/google/uuid v1.6.0', 'github.com/google/uuid v1.6.1')
      .replace('\tgithub.com/old/thing v1.2.0\n', '')
      .replace('golang.org/x/sync v0.7.0 // indirect', 'golang.org/x/sync v0.8.0 // indirect\n\tgithub.com/new/dep v1.0.0')
      .replace('go 1.22', 'go 1.23')
    const diff = diffGoMod('go.mod', BASE, head)
    expect(diff.otherFields).toEqual(['go'])
    expect(diff.changes.map((c) => [c.name, c.change, c.section, c.bump, c.critical])).toEqual([
      ['github.com/google/uuid', 'updated', 'require', 'patch', false],
      ['github.com/new/dep', 'added', 'require', null, false],
      ['github.com/old/thing', 'removed', 'require', null, true],
      ['golang.org/x/sync', 'updated', 'indirect', 'major', true],
    ])
  })
})
