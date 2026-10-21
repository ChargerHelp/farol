import { describe, expect, it } from 'vitest'
import { diffPyproject, diffRequirementsTxt, parsePep508, pyBump } from '../../src/python/pyproject.js'

describe('Python manifests', () => {
  it('reads PEP 508 requirements without extras or markers, with PEP 503 names', () => {
    expect(parsePep508('FastAPI[all] >= 0.110, <1 ; python_version >= "3.11"')).toEqual({ name: 'fastapi', spec: '>=0.110,<1' })
    expect(parsePep508('Pydantic_Settings')).toEqual({ name: 'pydantic-settings', spec: '' })
  })

  it('compares lower bounds: 0.x minors and majors are major, removed lower bounds unknown', () => {
    expect(pyBump('>=1.2', '>=1.3')).toEqual({ bump: 'minor', direction: 'upgrade' })
    expect(pyBump('>=0.110', '>=0.111')).toEqual({ bump: 'major', direction: 'upgrade' })
    expect(pyBump('==2.0.1', '==2.0.3')).toEqual({ bump: 'patch', direction: 'upgrade' })
    expect(pyBump('^1.4', '~1.4')).toEqual({ bump: 'range', direction: null })
    expect(pyBump('>=1.0', '<2').bump).toBe('unknown')
  })

  it('diffs pyproject requirements per extra and group; dev-tool settings are not manifest changes', () => {
    const base = { project: { version: '1', 'requires-python': '>=3.11', dependencies: ['a>=1.0'], 'optional-dependencies': { api: ['b>=2.0'], worker: ['b>=2.0'] } }, 'dependency-groups': { dev: ['pytest>=8'] }, tool: { ruff: { 'line-length': 100 } } }
    const head = { project: { version: '2', 'requires-python': '>=3.12', dependencies: ['a>=1.1'], 'optional-dependencies': { api: ['b>=3.0'] } }, 'dependency-groups': { dev: ['pytest>=8', 'ruff'] }, tool: { ruff: { 'line-length': 120 } } }
    const diff = diffPyproject('pyproject.toml', base, head)
    expect(diff.otherFields).toEqual(['project.requires-python'])
    expect(diff.changes.map((c) => [c.name, c.section, c.group ?? null, c.change, c.bump, c.critical])).toEqual([
      ['a', 'dependencies', null, 'updated', 'minor', false],
      ['b', 'optionalDependencies', 'api', 'updated', 'major', true],
      ['b', 'optionalDependencies', 'worker', 'removed', null, true],
      ['ruff', 'devDependencies', 'dev', 'added', null, false],
    ])
  })

  it('diffs requirements.txt, with option lines as a setting', () => {
    const diff = diffRequirementsTxt('requirements.txt', 'flask==2.3.0\n# comment\nrequests>=2.31\n', '--index-url https://example.com\nflask==3.0.0\nrequests>=2.31\n')
    expect(diff.otherFields).toEqual(['options'])
    expect(diff.changes.map((c) => [c.name, c.bump, c.critical])).toEqual([['flask', 'major', true]])
  })
})
