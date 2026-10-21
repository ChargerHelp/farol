import { compareStrings } from '../output/order.js'
import { sortChanges, type Bump, type DependencyChange, type ManifestDiff } from '../classify/dependencies.js'

/** One go.mod: required modules (direct or `// indirect`) and every other directive as comparable text. */
export interface GoMod {
  require: Map<string, { version: string; indirect: boolean }>
  /** Directive name → sorted lines (module, go, toolchain, replace, exclude, retract, godebug, tool…). */
  other: Map<string, string[]>
}

/**
 * Reads go.mod by its line grammar (directives, `( … )` blocks, `//` comments). Only the file's text is read;
 * module resolution is the Go helper's job.
 */
export function parseGoMod(text: string): GoMod {
  const require = new Map<string, { version: string; indirect: boolean }>()
  const other = new Map<string, string[]>()
  let block: string | null = null
  const addOther = (directive: string, rest: string): void => {
    other.set(directive, [...(other.get(directive) ?? []), rest])
  }
  for (const raw of text.split('\n')) {
    const comment = raw.indexOf('//')
    const indirect = comment >= 0 && raw.slice(comment + 2).trim().startsWith('indirect')
    const line = (comment >= 0 ? raw.slice(0, comment) : raw).trim()
    if (line === '') continue
    if (block !== null) {
      if (line === ')') {
        block = null
        continue
      }
      if (block === 'require') addRequire(require, line, indirect)
      else addOther(block, line)
      continue
    }
    const [directive = '', ...restParts] = line.split(/\s+/)
    const rest = restParts.join(' ')
    if (rest === '(') {
      block = directive
      continue
    }
    if (directive === 'require') addRequire(require, rest, indirect)
    else addOther(directive, rest)
  }
  for (const [k, v] of other) other.set(k, [...v].sort(compareStrings))
  return { require, other }
}

function addRequire(map: GoMod['require'], spec: string, indirect: boolean): void {
  const [path, version] = spec.split(/\s+/)
  if (path !== undefined && version !== undefined) map.set(path, { version, indirect })
}

interface GoVersion {
  major: number
  minor: number
  patch: number
  rest: string
}

function parseGoVersion(v: string): GoVersion | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v.replace('+incompatible', ''))
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), rest: m[4] ?? '' } : null
}

/** Bump between two module versions; pseudo-versions of the same base are `unknown` (any commit may have landed). */
export function goBump(from: string, to: string): { bump: Bump; direction: 'upgrade' | 'downgrade' | null } {
  const a = parseGoVersion(from)
  const c = parseGoVersion(to)
  if (!a || !c) return { bump: 'unknown', direction: null }
  const order = c.major - a.major || c.minor - a.minor || c.patch - a.patch
  const direction = order > 0 ? 'upgrade' : order < 0 ? 'downgrade' : null
  if (a.major !== c.major) return { bump: 'major', direction }
  // Before v1, a minor bump may break the API (same rule as 0.x npm packages).
  if (a.minor !== c.minor) return { bump: a.major === 0 ? 'major' : 'minor', direction }
  if (a.patch !== c.patch) return { bump: 'patch', direction }
  return { bump: 'unknown', direction: null }
}

/**
 * Dependency changes between base and head go.mod (null: the file does not exist). Direct requirements follow the
 * package.json rules (removal, major or unknown bumps and downgrades are critical); `// indirect` ones are critical
 * only on a major bump. Any other directive that changed (go, toolchain, replace…) is reported as a manifest change.
 */
export function diffGoMod(manifest: string, baseText: string | null, headText: string | null): ManifestDiff {
  const base = baseText === null ? parseGoMod('') : parseGoMod(baseText)
  const head = headText === null ? parseGoMod('') : parseGoMod(headText)
  const changes: DependencyChange[] = []
  const section = (indirect: boolean) => (indirect ? ('indirect' as const) : ('require' as const))
  for (const [name, before] of base.require) {
    const after = head.require.get(name)
    if (!after) {
      changes.push({ manifest, name, section: section(before.indirect), change: 'removed', from: before.version, to: null, bump: null, direction: null, critical: !before.indirect, ...(before.indirect ? { note: 'indirect requirement no longer needed' } : {}) })
      continue
    }
    if (after.version === before.version && after.indirect === before.indirect) continue
    const { bump, direction } = after.version === before.version ? { bump: null, direction: null } : goBump(before.version, after.version)
    const critical = after.indirect ? bump === 'major' : bump === 'major' || bump === 'unknown' || direction === 'downgrade'
    changes.push({
      manifest,
      name,
      section: section(after.indirect),
      change: after.indirect === before.indirect ? 'updated' : 'moved',
      from: before.version,
      to: after.version,
      ...(after.indirect === before.indirect ? {} : { fromSection: section(before.indirect) }),
      bump,
      direction,
      critical,
      ...(bump === 'unknown' ? { note: 'pseudo-version or unparsable version: compare the commits' } : {}),
    })
  }
  for (const [name, after] of head.require) {
    if (!base.require.has(name)) changes.push({ manifest, name, section: section(after.indirect), change: 'added', from: null, to: after.version, bump: null, direction: null, critical: false })
  }
  const directives = new Set([...base.other.keys(), ...head.other.keys()])
  const otherFields = [...directives].filter((d) => (base.other.get(d) ?? []).join('\n') !== (head.other.get(d) ?? []).join('\n')).sort(compareStrings)
  return { manifest, changes: sortChanges(changes), otherFields }
}
