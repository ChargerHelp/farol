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
  /** Folders a `workspace:` dependency of `<dir>/package.json` may name (see `WorkspaceLinks.candidates`); git trees only. */
  workspaceCandidates?(dir: string, name: string): readonly string[] | undefined
}

export function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** Whether an absolute path belongs to the repository's own code: inside it and not in an installed package. */
export function isProjectPath(root: string, path: string): boolean {
  const p = toPosix(path)
  return isInside(toPosix(root), p) && !p.includes('/node_modules/')
}

/** `dir` and the directories above it, up to `root` (absolute); empty when `dir` is outside `root`. */
export function ancestors(dir: string, root: string): string[] {
  const out: string[] = []
  for (let d = dir; isInside(root, d); d = posix.dirname(d)) {
    out.push(d)
    if (d === root || posix.dirname(d) === d) break
  }
  return out
}

/** Build outputs a workspace package ships, and the TypeScript sources they come from, in lookup order. */
const OUTPUT_EXTENSIONS = ['.d.mts', '.d.cts', '.d.ts', '.mjs', '.cjs', '.js', '.jsx']
const TS_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']

type Location =
  | { kind: 'tree'; rel: string } // repo-relative path in the tree, after following workspace links
  | { kind: 'modules'; rel: string; path: string } // a `node_modules` or `node_modules/@scope` directory: links plus installed packages
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
  const relOf = (path: string): string | undefined => (isInside(root, path) ? (path === root ? '' : path.slice(root.length + 1)) : undefined)

  const locate = (path: string): Location => {
    const p = toPosix(path)
    const rel = relOf(p)
    const followed = rel === undefined ? undefined : links.follow(rel)
    if (followed === undefined) return { kind: 'fallback', path: p }
    return followed.kind === 'tree' ? { kind: 'tree', rel: followed.rel } : { kind: 'modules', rel: followed.rel, path: abs(followed.rel) }
  }

  /** `<package>/src/<sub>` for a `<package>/dist/<sub>` path of a linked package; undefined otherwise. */
  const sourceOf = (rel: string): string | undefined => {
    const segments = rel.split('/')
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] === 'dist' && links.isLinked(segments.slice(0, i).join('/'))) return [...segments.slice(0, i), 'src', ...segments.slice(i + 1)].join('/')
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
    return TS_SOURCE_EXTENSIONS.map((e) => stem + e).find((f) => files.has(f))
  }
  /**
   * The committed directory, or a missing output directory of a linked package, with the subdirectories of the source
   * directory it mirrors (output file names are only known when asked for, so none are listed).
   */
  const treeDirectory = (rel: string): { files: ReadonlySet<string>; directories: ReadonlySet<string> } | undefined => {
    const committed = children.get(rel)
    if (committed) return committed
    const source = sourceOf(rel)
    const mirrored = source === undefined ? undefined : children.get(source)
    return mirrored && { files: new Set(), directories: mirrored.directories }
  }
  const modulesEntries = (l: { rel: string; path: string }): { files: string[]; directories: string[] } => {
    const installed = options.fallback.getEntries(l.path)
    return { files: installed.files, directories: [...new Set([...installed.directories, ...links.entries(l.rel)])] }
  }

  return {
    fileExists: (path) => {
      const l = locate(path)
      return l.kind === 'tree' ? treeFile(l.rel) !== undefined : options.fallback.fileExists(l.path)
    },
    readFile: (path) => {
      const l = locate(path)
      if (l.kind !== 'tree') return options.fallback.readFile(l.path)
      const file = treeFile(l.rel)
      return file === undefined ? undefined : content(file)
    },
    directoryExists: (path) => {
      const l = locate(path)
      if (l.kind === 'tree') return treeDirectory(l.rel) !== undefined
      return (l.kind === 'modules' && links.entries(l.rel).length > 0) || options.fallback.directoryExists(l.path)
    },
    getDirectories: (path) => {
      const l = locate(path)
      if (l.kind === 'tree') return [...(treeDirectory(l.rel)?.directories ?? [])]
      return l.kind === 'modules' ? modulesEntries(l).directories : options.fallback.getDirectories(l.path)
    },
    getEntries: (path) => {
      const l = locate(path)
      if (l.kind === 'modules') return modulesEntries(l)
      if (l.kind === 'fallback') return options.fallback.getEntries(l.path)
      const e = treeDirectory(l.rel)
      return { files: [...(e?.files ?? [])], directories: [...(e?.directories ?? [])] }
    },
    realpath: (path) => {
      const l = locate(path)
      return l.kind === 'tree' ? abs(treeFile(l.rel) ?? l.rel) : toPosix(options.fallback.realpath(l.path))
    },
    workspaceCandidates: (dir, name) => {
      const rel = relOf(toPosix(dir))
      return rel === undefined ? undefined : links.candidates(rel, name)?.map(abs)
    },
  }
}
