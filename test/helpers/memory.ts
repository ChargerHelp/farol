import { createTreeFileSystem, type ProjectFileSystem } from '../../src/project/fs.js'
import { createProjectProgram, type ProjectProgram } from '../../src/project/program.js'

export const ROOT = '/repo'

const EMPTY: ProjectFileSystem = {
  fileExists: () => false,
  readFile: () => undefined,
  directoryExists: () => false,
  getDirectories: () => [],
  getEntries: () => ({ files: [], directories: [] }),
  realpath: (p) => p,
}

/** In-memory project rooted at /repo; `files` maps repo-relative paths to contents. */
export function memoryProject(files: Record<string, string>, anchor = 'src/routes.tsx'): ProjectProgram {
  const tsconfig = files['tsconfig.json'] ?? JSON.stringify({ compilerOptions: { jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'bundler', resolveJsonModule: true, paths: { '@/*': ['./src/*'] } }, include: ['src'] })
  const all = { 'tsconfig.json': tsconfig, ...files }
  const fs = createTreeFileSystem({ repoRoot: ROOT, files: Object.keys(all), contents: new Map(Object.entries(all)), fallback: EMPTY })
  return createProjectProgram({ fs, projectDir: ROOT, tsconfigPath: `${ROOT}/tsconfig.json`, anchorFile: `${ROOT}/${anchor}` })
}
