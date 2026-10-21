import { isDeepStrictEqual } from 'node:util'
import { compareStrings } from '../output/order.js'
import { sortChanges, type Bump, type DependencyChange, type DependencySection, type ManifestDiff } from '../classify/dependencies.js'
import { normalizeName } from '../signals/python.js'

/** One requirement: where it is declared and its version specifier (PEP 440, or Poetry's ^ and ~). */
interface Requirement {
  section: DependencySection
  group: string | undefined
  name: string
  spec: string
}

type Table = Record<string, unknown>

const table = (v: unknown): Table => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Table) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** `fastapi[all]>=0.110,<1; python_version >= "3.11"` → name and specifier (markers and extras dropped). */
export function parsePep508(line: string): { name: string; spec: string } | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(line.split(';')[0] ?? '')
  if (!m?.[1]) return null
  const spec = (m[3] ?? '').trim().replace(/^\((.*)\)$/, '$1').replace(/\s+/g, '')
  return { name: normalizeName(m[1]), spec }
}

function fromList(items: unknown[], section: DependencySection, group: string | undefined): Requirement[] {
  return items.flatMap((item) => {
    const parsed = typeof item === 'string' ? parsePep508(item) : null
    return parsed ? [{ section, group, ...parsed }] : []
  })
}

function fromPoetry(deps: Table, section: DependencySection, group: string | undefined): Requirement[] {
  return Object.entries(deps)
    .filter(([name]) => name.toLowerCase() !== 'python')
    .map(([name, v]) => ({ section, group, name: normalizeName(name), spec: typeof v === 'string' ? v : typeof table(v).version === 'string' ? (table(v).version as string) : JSON.stringify(v) }))
}

/** Every requirement of a parsed pyproject.toml: PEP 621, PEP 735 dependency groups, uv and Poetry. */
export function pyprojectRequirements(data: unknown): Requirement[] {
  const root = table(data)
  const project = table(root.project)
  const tool = table(root.tool)
  const poetry = table(tool.poetry)
  const out: Requirement[] = [...fromList(list(project.dependencies), 'dependencies', undefined)]
  for (const [extra, items] of Object.entries(table(project['optional-dependencies']))) out.push(...fromList(list(items), 'optionalDependencies', extra))
  for (const [group, items] of Object.entries(table(root['dependency-groups']))) out.push(...fromList(list(items), 'devDependencies', group))
  out.push(...fromList(list(table(tool.uv)['dev-dependencies']), 'devDependencies', 'dev'))
  out.push(...fromPoetry(table(poetry.dependencies), 'dependencies', undefined))
  out.push(...fromPoetry(table(poetry['dev-dependencies']), 'devDependencies', 'dev'))
  for (const [group, g] of Object.entries(table(poetry.group))) out.push(...fromPoetry(table(table(g).dependencies), 'devDependencies', group))
  return out
}

/** Settings that change what gets installed or run; documentation and dev-tool settings (ruff, pytest…) do not. */
const DOC_FIELDS = new Set(['version', 'description', 'readme', 'authors', 'maintainers', 'keywords', 'classifiers', 'urls', 'license', 'license-files', 'dependencies', 'optional-dependencies'])
const DEV_TOOLS = new Set(['ruff', 'pytest', 'coverage', 'mypy', 'black', 'isort', 'pyright', 'pylint', 'bandit', 'codespell', 'flake8', 'commitizen', 'bumpversion'])

function settings(data: unknown): Map<string, unknown> {
  const root = table(data)
  const out = new Map<string, unknown>()
  for (const [k, v] of Object.entries(table(root.project))) if (!DOC_FIELDS.has(k)) out.set(`project.${k}`, v)
  if (root['build-system'] !== undefined) out.set('build-system', root['build-system'])
  for (const [name, cfg] of Object.entries(table(root.tool))) {
    if (DEV_TOOLS.has(name)) continue
    for (const [k, v] of Object.entries(table(cfg))) {
      if ((name === 'uv' && k === 'dev-dependencies') || (name === 'poetry' && ['dependencies', 'dev-dependencies', 'group', 'version', 'description', 'authors', 'readme'].includes(k))) continue
      out.set(`tool.${name}.${k}`, v)
    }
  }
  return out
}

/** Lowest version a specifier allows (`>=1.2`, `==1.2.3`, `~=1.4`, `^1.2`), as [major, minor, patch]. */
function lowerBound(spec: string): number[] | null {
  for (const raw of spec.split(',')) {
    const clause = raw.trim()
    if (clause.startsWith('<') || clause.startsWith('!=')) continue
    const m = /^(?:===|==|>=|~=|\^|~|>)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(clause)
    if (m) return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
  }
  return null
}

export function pyBump(from: string, to: string): { bump: Bump; direction: 'upgrade' | 'downgrade' | null } {
  const a = lowerBound(from)
  const b = lowerBound(to)
  if (!a || !b) return { bump: a === b ? 'range' : 'unknown', direction: null }
  const [a0 = 0, a1 = 0, a2 = 0] = a
  const [b0 = 0, b1 = 0, b2 = 0] = b
  const order = b0 - a0 || b1 - a1 || b2 - a2
  const direction = order > 0 ? 'upgrade' : order < 0 ? 'downgrade' : null
  if (a0 !== b0) return { bump: 'major', direction }
  if (a1 !== b1) return { bump: a0 === 0 ? 'major' : 'minor', direction }
  if (a2 !== b2) return { bump: 'patch', direction }
  return { bump: 'range', direction: null }
}

/** Dependency changes between two requirement lists, with the npm rules for what is critical. */
export function diffRequirements(manifest: string, before: Requirement[], after: Requirement[], otherFields: string[]): ManifestDiff {
  const key = (r: Requirement): string => `${r.section}\0${r.group ?? ''}\0${r.name}`
  const base = new Map(before.map((r) => [key(r), r]))
  const head = new Map(after.map((r) => [key(r), r]))
  const changes: DependencyChange[] = []
  const withGroup = (r: Requirement) => (r.group === undefined ? {} : { group: r.group })
  for (const [k, r] of base) {
    const now = head.get(k)
    if (!now) changes.push({ manifest, name: r.name, section: r.section, ...withGroup(r), change: 'removed', from: r.spec, to: null, bump: null, direction: null, critical: true })
    else if (now.spec !== r.spec) {
      const { bump, direction } = pyBump(r.spec, now.spec)
      changes.push({ manifest, name: r.name, section: r.section, ...withGroup(r), change: 'updated', from: r.spec, to: now.spec, bump, direction, critical: bump === 'major' || bump === 'unknown' || direction === 'downgrade' })
    }
  }
  for (const [k, r] of head) if (!base.has(k)) changes.push({ manifest, name: r.name, section: r.section, ...withGroup(r), change: 'added', from: null, to: r.spec, bump: null, direction: null, critical: false })
  return { manifest, changes: sortChanges(changes), otherFields: [...otherFields].sort(compareStrings) }
}

/** pyproject.toml diff from both parsed versions (null: the file does not exist). */
export function diffPyproject(manifest: string, base: unknown, head: unknown): ManifestDiff {
  const a = settings(base)
  const b = settings(head)
  const other = [...new Set([...a.keys(), ...b.keys()])].filter((k) => !isDeepStrictEqual(a.get(k), b.get(k)))
  return diffRequirements(manifest, pyprojectRequirements(base), pyprojectRequirements(head), other)
}

/** requirements.txt: one PEP 508 requirement per line; option lines (-r, -c, --index-url…) are settings. */
export function requirementsTxt(text: string | null): { requirements: Requirement[]; options: string[] } {
  const requirements: Requirement[] = []
  const options: string[] = []
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (line === '') continue
    if (line.startsWith('-')) options.push(line)
    else {
      const parsed = parsePep508(line)
      if (parsed) requirements.push({ section: 'dependencies', group: undefined, ...parsed })
    }
  }
  return { requirements, options: options.sort(compareStrings) }
}

export function diffRequirementsTxt(manifest: string, baseText: string | null, headText: string | null): ManifestDiff {
  const a = requirementsTxt(baseText)
  const b = requirementsTxt(headText)
  return diffRequirements(manifest, a.requirements, b.requirements, a.options.join('\n') === b.options.join('\n') ? [] : ['options'])
}
