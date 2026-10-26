import { posix } from 'node:path'
import { readWorkspaceLinks } from './workspace-links.js'

/** Synchronous file system seen by the TypeScript compiler. Paths are absolute, with `/`. */
export interface ProjectFileSystem {
  fileExists(path: string): boolean
  readFile(path: string): string | undefined
  directoryExists(path: string): boolean
  getDirectories(path: string): string[]
  /** Files and directories directly inside a directory (names, not paths). */
  getEntries(path: string): { files: string[]; directories: string[] }
  realpath(path: string): string
}

export function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** Build outputs a workspace package ships, and the source extensions they come from, in lookup order. */
const OUTPUT_EXTENSIONS = ['.d.mts', '.d.cts', '.d.ts', '.mjs', '.cjs', '.js', '.jsx']
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']

type Location =
  | { kind: 'tree'; rel: string } // repo-relative path in the tree, after following workspace links
  | { kind: 'modules'; rel: string } // a `node_modules` or `node_modules/@scope` directory: links plus installed packages
  | { kind: 'fallback'; path: string }

/**
 * File system of a git tree: every file listed in the tree exists; contents come from `contents` (prefetched).
 * Workspace packages come from the tree too: `<dir>/node_modules/<name>` is the folder of the package `<name>` when
 * the committed `<dir>/package.json` declares it with `workspace:` (see `readWorkspaceLinks`). Inside such a package,
 * a missing `dist/<path>` is the committed `src/<path>` it is built from (`dist/index.d.mts` is `src/index.ts`, and
 * its realpath), so the compiler reads the sources of the package instead of a build that may be stale or absent.
 * Other paths outside the repository or inside `node_modules` (never committed) go to `fallback`, usually the real
 * disk, so installed third-party packages still resolve.
 */
export function createTreeFileSystem(options: {
  repoRoot: string
  files: readonly string[]
  contents: ReadonlyMap<string, string>
  fallback: ProjectFileSystem
}): ProjectFileSystem {
  const root = toPosix(options.repoRoot)
  const files = new Set(options.files)
  const children = new Map<string, { files: Set<string>; directories: Set<string> }>()
  const entry = (dir: string): { files: Set<string>; directories: Set<string> } => {
    let e = children.get(dir)
    if (!e) {
      e = { files: new Set(), directories: new Set() }
      children.set(dir, e)
    }
    return e
  }
  entry('')
  for (const file of files) {
    let dir = posix.dirname(file)
    let name = posix.basename(file)
    if (dir === '.') dir = ''
    entry(dir).files.add(name)
    while (dir !== '') {
      name = posix.basename(dir)
      let parent = posix.dirname(dir)
      if (parent === '.') parent = ''
      entry(parent).directories.add(name)
      dir = parent
    }
  }
  const content = (rel: string): string => {
    const text = options.contents.get(rel)
    if (text === undefined) throw new Error(`internal: ${rel} exists in the tree but was not prefetched`)
    return text
  }
  const links = readWorkspaceLinks(files, content)
  const abs = (rel: string): string => (rel === '' ? root : `${root}/${rel}`)

  const locate = (path: string): Location => {
    const p = toPosix(path)
    if (!isInside(root, p)) return { kind: 'fallback', path: p }
    let segments = p === root ? [] : p.slice(root.length + 1).split('/')
    for (;;) {
      const i = segments.indexOf('node_modules')
      if (i === -1) return { kind: 'tree', rel: segments.join('/') }
      const nameEnd = i + (segments[i + 1]?.startsWith('@') === true ? 3 : 2)
      if (segments.length < nameEnd) return { kind: 'modules', rel: segments.join('/') }
      const folder = links.target(segments.slice(0, i).join('/'), segments.slice(i + 1, nameEnd).join('/'))
      if (folder === undefined) return { kind: 'fallback', path: abs(segments.join('/')) }
      segments = [...(folder === '' ? [] : folder.split('/')), ...segments.slice(nameEnd)]
    }
  }

  /** `<package>/src/<sub>` for a `<package>/dist/<sub>` path of a linked package; undefined otherwise. */
  const sourceOf = (rel: string): string | undefined => {
    const segments = rel.split('/')
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] !== 'dist') continue
      const pkg = segments.slice(0, i).join('/')
      if (links.isLinked(pkg)) return [...segments.slice(0, i), 'src', ...segments.slice(i + 1)].join('/')
    }
    return undefined
  }
  /** The committed file, or the source a missing build output of a linked package is built from. */
  const treeFile = (rel: string): string | undefined => {
    if (files.has(rel)) return rel
    const source = sourceOf(rel)
    const ext = source === undefined ? undefined : OUTPUT_EXTENSIONS.find((e) => source.endsWith(e))
    if (source === undefined || ext === undefined) return undefined
    const stem = source.slice(0, -ext.length)
    return SOURCE_EXTENSIONS.map((e) => stem + e).find((f) => files.has(f))
  }
  const treeDirectory = (rel: string): boolean => {
    if (children.has(rel)) return true
    const source = sourceOf(rel)
    return source !== undefined && children.has(source)
  }
  const merged = (path: string, rel: string): { files: string[]; directories: string[] } => {
    const disk = options.fallback.getEntries(path)
    return { files: disk.files, directories: [...new Set([...disk.directories, ...links.entries(rel)])] }
  }

  return {
    fileExists: (path) => {
      const l = locate(path)
      return l.kind === 'tree' ? treeFile(l.rel) !== undefined : options.fallback.fileExists(l.kind === 'modules' ? abs(l.rel) : l.path)
    },
    readFile: (path) => {
      const l = locate(path)
      if (l.kind !== 'tree') return options.fallback.readFile(l.kind === 'modules' ? abs(l.rel) : l.path)
      const file = treeFile(l.rel)
      return file === undefined ? undefined : content(file)
    },
    directoryExists: (path) => {
      const l = locate(path)
      if (l.kind === 'tree') return treeDirectory(l.rel)
      if (l.kind === 'modules') return links.entries(l.rel).length > 0 || options.fallback.directoryExists(abs(l.rel))
      return options.fallback.directoryExists(l.path)
    },
    getDirectories: (path) => {
      const l = locate(path)
      if (l.kind === 'tree') return [...(children.get(l.rel)?.directories ?? [])]
      if (l.kind === 'modules') return merged(abs(l.rel), l.rel).directories
      return options.fallback.getDirectories(l.path)
    },
    getEntries: (path) => {
      const l = locate(path)
      if (l.kind === 'modules') return merged(abs(l.rel), l.rel)
      if (l.kind === 'fallback') return options.fallback.getEntries(l.path)
      const e = children.get(l.rel)
      return { files: [...(e?.files ?? [])], directories: [...(e?.directories ?? [])] }
    },
    realpath: (path) => {
      const l = locate(path)
      if (l.kind === 'tree') return abs(treeFile(l.rel) ?? l.rel)
      return toPosix(options.fallback.realpath(l.kind === 'modules' ? abs(l.rel) : l.path))
    },
  }
}
