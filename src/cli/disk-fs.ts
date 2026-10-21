import { readdirSync, realpathSync, statSync } from 'node:fs'
import ts from 'typescript'
import type { ProjectFileSystem } from '../project/fs.js'
import { toPosix } from '../project/fs.js'

/** The real file system, for the working tree and for installed packages (node_modules). */
export function createDiskFileSystem(): ProjectFileSystem {
  return {
    fileExists: (p) => ts.sys.fileExists(p),
    readFile: (p) => ts.sys.readFile(p),
    directoryExists: (p) => ts.sys.directoryExists(p),
    getDirectories: (p) => ts.sys.getDirectories(p),
    getEntries: (p) => {
      const files: string[] = []
      const directories: string[] = []
      let names: string[]
      try {
        names = readdirSync(p)
      } catch {
        return { files, directories }
      }
      for (const name of names) {
        try {
          const s = statSync(`${p}/${name}`)
          if (s.isDirectory()) directories.push(name)
          else if (s.isFile()) files.push(name)
        } catch {
          // Broken symlink: invisible to the compiler as well.
        }
      }
      return { files, directories }
    },
    realpath: (p) => {
      try {
        return toPosix(realpathSync(p))
      } catch {
        return toPosix(p)
      }
    },
  }
}
