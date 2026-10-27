import ts from 'typescript'
import { posix } from 'node:path'

export const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

/** `x` or `@scope/x` of a bare specifier (or of the start of a path under `node_modules`); undefined for `node:` built-ins. */
export function packageName(specifier: string): string | undefined {
  if (specifier.startsWith('node:')) return undefined
  const [first = '', second] = specifier.split('/')
  if (!first.startsWith('@')) return first
  return second === undefined ? undefined : `${first}/${second}`
}

/**
 * The `node_modules` links a pnpm install makes for workspace packages, read from the committed manifests: a
 * dependency declared with the `workspace:` protocol in `<dir>/package.json` links `<dir>/node_modules/<name>` to the
 * folder of the package named `<name>`. Directories are repo-relative ('' for the repository root).
 */
export interface WorkspaceLinks {
  /**
   * Folders a `workspace:` dependency `name` of `<dir>/package.json` may point to: one when it links; when it does not,
   * every folder with that name plus every folder whose manifest is invalid (its name is unknown). Undefined when the
   * manifest does not declare it; an invalid manifest declares every name.
   */
  candidates(dir: string, name: string): readonly string[] | undefined
  /** Whether a folder is the target of a link. */
  isLinked(folder: string): boolean
  /**
   * A repo-relative path with every link followed: a path of the tree, a `node_modules` (or `node_modules/@scope`)
   * directory, which links and installed packages share, or undefined for an installed package.
   */
  follow(rel: string): { kind: 'tree' | 'modules'; rel: string } | undefined
  /** Names links add directly inside a `node_modules` (or `node_modules/@scope`) directory. */
  entries(dir: string): readonly string[]
}

export interface Manifest {
  name?: string
  workspace: string[]
  invalid: boolean
}

/** Name and `workspace:` dependencies of a package.json. */
export function readManifest(path: string, text: string): Manifest {
  const { config, error } = ts.parseConfigFileTextToJson(path, text) as { config?: unknown; error?: unknown }
  if (error !== undefined || typeof config !== 'object' || config === null || Array.isArray(config)) return { workspace: [], invalid: true }
  const json = config as Record<string, unknown>
  const workspace: string[] = []
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = json[section]
    if (typeof deps !== 'object' || deps === null) continue
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) if (typeof spec === 'string' && spec.startsWith('workspace:')) workspace.push(name)
  }
  return { ...(typeof json.name === 'string' ? { name: json.name } : {}), workspace, invalid: false }
}

const dirOf = (file: string): string => (posix.dirname(file) === '.' ? '' : posix.dirname(file))
const join = (dir: string, path: string): string => (dir === '' ? path : `${dir}/${path}`)

/** Links of every committed package.json outside `node_modules`. A name two folders share links nowhere. */
export function readWorkspaceLinks(files: Iterable<string>, read: (file: string) => string): WorkspaceLinks {
  const folders = new Map<string, string[]>()
  const declared = new Map<string, Set<string>>()
  const invalid = new Set<string>()
  for (const file of files) {
    if (posix.basename(file) !== 'package.json' || file.split('/').includes('node_modules')) continue
    const manifest = readManifest(file, read(file))
    const dir = dirOf(file)
    if (manifest.invalid) invalid.add(dir)
    if (manifest.name !== undefined) folders.set(manifest.name, [...(folders.get(manifest.name) ?? []), dir])
    if (manifest.workspace.length > 0) declared.set(dir, new Set(manifest.workspace))
  }
  const target = (dir: string, name: string): string | undefined => {
    const named = folders.get(name)
    return declared.get(dir)?.has(name) && named?.length === 1 ? named[0] : undefined
  }
  const candidates = (dir: string, name: string): readonly string[] | undefined => {
    if (!invalid.has(dir) && !declared.get(dir)?.has(name)) return undefined
    const linked = target(dir, name)
    if (linked !== undefined) return [linked]
    return [...(folders.get(name) ?? []), ...[...invalid].filter((d) => d !== dir)].sort()
  }
  const entries = new Map<string, Set<string>>()
  const linked = new Set<string>()
  const add = (dir: string, name: string): void => {
    let set = entries.get(dir)
    if (!set) entries.set(dir, (set = new Set()))
    set.add(name)
  }
  for (const [dir, names] of declared) {
    for (const name of names) {
      const folder = target(dir, name)
      if (folder === undefined) continue
      linked.add(folder)
      const modules = join(dir, 'node_modules')
      const [first = name, rest] = name.split('/')
      add(modules, first)
      if (rest !== undefined) add(`${modules}/${first}`, rest)
    }
  }
  // Each pass replaces one `node_modules/<name>` with a folder of the tree, which has no `node_modules` segment.
  const follow = (rel: string): { kind: 'tree' | 'modules'; rel: string } | undefined => {
    let segments = rel === '' ? [] : rel.split('/')
    for (;;) {
      const i = segments.indexOf('node_modules')
      if (i === -1) return { kind: 'tree', rel: segments.join('/') }
      const name = packageName(segments.slice(i + 1).join('/'))
      if (name === undefined || name === '') return { kind: 'modules', rel: segments.join('/') }
      const folder = target(segments.slice(0, i).join('/'), name)
      if (folder === undefined) return undefined
      segments = [...(folder === '' ? [] : folder.split('/')), ...segments.slice(i + 1 + name.split('/').length)]
    }
  }
  return {
    candidates,
    isLinked: (folder) => linked.has(folder),
    follow,
    entries: (dir) => [...(entries.get(dir) ?? [])],
  }
}
