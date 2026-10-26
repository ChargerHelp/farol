import ts from 'typescript'
import { posix } from 'node:path'
import { DEPENDENCY_SECTIONS } from '../classify/dependencies.js'

/**
 * The `node_modules` links a pnpm install makes for workspace packages, read from the committed manifests: a
 * dependency declared with the `workspace:` protocol in `<dir>/package.json` links `<dir>/node_modules/<name>` to the
 * folder of the package named `<name>`. Directories are repo-relative ('' for the repository root).
 */
export interface WorkspaceLinks {
  /** Folder of the package `<dir>/node_modules/<name>` links to; undefined without such a link. */
  target(dir: string, name: string): string | undefined
  /** Whether `<dir>/package.json` declares `name` with the `workspace:` protocol. */
  declares(dir: string, name: string): boolean
  /** Names a link adds directly inside a `node_modules` (or `node_modules/@scope`) directory. */
  entries(dir: string): readonly string[]
  /** Whether a folder is the target of a link. */
  isLinked(folder: string): boolean
}

export interface Manifest {
  name?: string
  workspace: string[]
}

/** Name and `workspace:` dependencies of a package.json. An invalid one has neither, so imports of it stay unresolved. */
export function readManifest(path: string, text: string): Manifest {
  const { config } = ts.parseConfigFileTextToJson(path, text) as { config?: unknown }
  if (typeof config !== 'object' || config === null) return { workspace: [] }
  const json = config as Record<string, unknown>
  const workspace: string[] = []
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = json[section]
    if (typeof deps !== 'object' || deps === null) continue
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) if (typeof spec === 'string' && spec.startsWith('workspace:')) workspace.push(name)
  }
  return { ...(typeof json.name === 'string' ? { name: json.name } : {}), workspace }
}

const dirOf = (file: string): string => (posix.dirname(file) === '.' ? '' : posix.dirname(file))
const join = (dir: string, path: string): string => (dir === '' ? path : `${dir}/${path}`)

/** Links of every committed package.json outside `node_modules`. A name two folders share links nowhere. */
export function readWorkspaceLinks(files: Iterable<string>, read: (file: string) => string): WorkspaceLinks {
  const folders = new Map<string, string | null>()
  const declared = new Map<string, Set<string>>()
  for (const file of files) {
    if (posix.basename(file) !== 'package.json' || file.split('/').includes('node_modules')) continue
    const manifest = readManifest(file, read(file))
    const dir = dirOf(file)
    if (manifest.name !== undefined) folders.set(manifest.name, folders.has(manifest.name) ? null : dir)
    if (manifest.workspace.length > 0) declared.set(dir, new Set(manifest.workspace))
  }
  const target = (dir: string, name: string): string | undefined => (declared.get(dir)?.has(name) ? (folders.get(name) ?? undefined) : undefined)
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
  return {
    target,
    declares: (dir, name) => declared.get(dir)?.has(name) ?? false,
    entries: (dir) => [...(entries.get(dir) ?? [])],
    isLinked: (folder) => linked.has(folder),
  }
}
