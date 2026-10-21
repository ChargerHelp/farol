import { realpathSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { loadConfig, UsageError } from '../config/load.js'
import type { Config } from '../config/schema.js'
import { repoRoot } from '../git/index.js'

export interface GlobalOptions {
  config: string
  cwd?: string
  verbose: boolean
}

export interface Context {
  /** Absolute, real path of the project directory (where the configuration and tsconfig live). */
  projectDir: string
  /** Absolute, real path of the git repository root. */
  repoRoot: string
  /** Project directory relative to the repository root, with `/` ('' when they are the same). */
  projectPrefix: string
  config: Config
  configPath: string
  verbose: boolean
  log: (message: string) => void
}

export function resolveProjectDir(cwd: string | undefined): string {
  const dir = resolve(cwd ?? process.cwd())
  try {
    if (!statSync(dir).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new UsageError(`--cwd ${dir} is not a directory`)
  }
  return realpathSync(dir)
}

export async function loadContext(options: GlobalOptions): Promise<Context> {
  const projectDir = resolveProjectDir(options.cwd)
  const { config, path } = loadConfig(projectDir, options.config)
  let root: string
  try {
    root = realpathSync(await repoRoot(projectDir))
  } catch {
    throw new UsageError(`${projectDir} is not inside a git repository; run farol from the repository (or pass --cwd)`)
  }
  const projectPrefix = relative(root, projectDir).split(sep).join('/')
  const verbose = options.verbose
  return {
    projectDir,
    repoRoot: root,
    projectPrefix,
    config,
    configPath: path,
    verbose,
    log: (message) => {
      if (verbose) process.stderr.write(`farol: ${message}\n`)
    },
  }
}
