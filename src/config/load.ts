import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { z } from 'zod'
import { ConfigSchema, type Config } from './schema.js'

/** Invalid usage or configuration: the CLI exits with code 1. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')
  if (issue.code === 'unrecognized_keys') return `${path}: unknown key(s) ${issue.keys.map((k) => `"${k}"`).join(', ')}; check the spelling against examples/farol.config.json`
  return `${path}: ${issue.message}`
}

/** Validates configuration text. `source` names the file in error messages. */
export function parseConfig(text: string, source: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new UsageError(`${source} is not valid JSON (${error instanceof Error ? error.message : String(error)}); fix the syntax`)
  }
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${formatIssue(issue)}`)
    throw new UsageError(`invalid configuration in ${source}:\n${lines.join('\n')}`)
  }
  return result.data
}

/** Reads and validates the configuration file; `configPath` is relative to the project directory. */
/** Default configuration file, and the name it had before the project was renamed (read when the default is missing). */
export const DEFAULT_CONFIG = 'farol.config.json'
const LEGACY_CONFIG = 'revscope.config.json'

export function loadConfig(projectDir: string, configPath: string): { config: Config; path: string } {
  let path = isAbsolute(configPath) ? configPath : resolve(projectDir, configPath)
  if (configPath === DEFAULT_CONFIG && !existsSync(path) && existsSync(resolve(projectDir, LEGACY_CONFIG))) path = resolve(projectDir, LEGACY_CONFIG)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new UsageError(`configuration file not found at ${path}; create it (see examples/farol.config.json) or pass --config`)
  }
  return { config: parseConfig(text, path), path }
}
