import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { OutputSchema, type Output } from './schema.js'

/** Validates the output against the schema and serializes it (2-space JSON, trailing newline). */
export function serializeOutput(output: Output): string {
  const result = OutputSchema.safeParse(output)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')
    throw new Error(`internal: the output does not match the schema (${issues})`)
  }
  return `${JSON.stringify(result.data, null, 2)}\n`
}

export function writeTextFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
