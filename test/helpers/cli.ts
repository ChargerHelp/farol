import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli.js')

export interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs the built binary (dist/cli.js), as the action does. */
export function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd,
    env: { ...process.env, GITHUB_REPOSITORY: '', ...options.env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}
