import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export default function setup(): void {
  // Deterministic git for scenario repositories, regardless of the developer's machine.
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  process.env.TZ = 'UTC'
  // End-to-end tests run the built binary: build it once so it always matches the sources.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  execFileSync(process.execPath, [join(root, 'node_modules', 'tsup', 'dist', 'cli-default.js')], { cwd: root, stdio: 'pipe' })
}
