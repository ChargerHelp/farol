import { posix } from 'node:path'

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

/**
 * File system of a git tree: every file listed in the tree exists; contents come from `contents`
 * (prefetched). Paths outside the repository or inside `node_modules` (never committed) go to `fallback`,
 * usually the real disk, so installed packages and workspace symlinks still resolve.
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

  /** Repo-relative path, or undefined when the path belongs to the fallback. */
  const inTree = (path: string): string | undefined => {
    const p = toPosix(path)
    if (!isInside(root, p)) return undefined
    const rel = p === root ? '' : p.slice(root.length + 1)
    if (rel === 'node_modules' || rel.startsWith('node_modules/') || rel.includes('/node_modules/') || rel.endsWith('/node_modules')) return undefined
    return rel
  }

  return {
    fileExists: (path) => {
      const rel = inTree(path)
      return rel === undefined ? options.fallback.fileExists(path) : files.has(rel)
    },
    readFile: (path) => {
      const rel = inTree(path)
      if (rel === undefined) return options.fallback.readFile(path)
      if (!files.has(rel)) return undefined
      const content = options.contents.get(rel)
      if (content === undefined) throw new Error(`internal: ${rel} exists in the tree but was not prefetched`)
      return content
    },
    directoryExists: (path) => {
      const rel = inTree(path)
      if (rel === undefined) return options.fallback.directoryExists(path)
      return children.has(rel)
    },
    getDirectories: (path) => {
      const rel = inTree(path)
      if (rel === undefined) return options.fallback.getDirectories(path)
      return [...(children.get(rel)?.directories ?? [])]
    },
    getEntries: (path) => {
      const rel = inTree(path)
      if (rel === undefined) return options.fallback.getEntries(path)
      const e = children.get(rel)
      return { files: [...(e?.files ?? [])], directories: [...(e?.directories ?? [])] }
    },
    realpath: (path) => {
      const rel = inTree(path)
      return rel === undefined ? toPosix(options.fallback.realpath(path)) : toPosix(path)
    },
  }
}
