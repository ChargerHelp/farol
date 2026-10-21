import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, loadConfig } from '../../src/config/load.js'
import { findFarolComment } from '../../src/github/comment.js'
import { OutputSchema } from '../../src/output/schema.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

describe('compatibility with the former name (revscope)', () => {
  it('updates a comment written with the old marker instead of adding a new one', () => {
    const comments = [
      { id: 1, body: 'hello', html_url: 'u1' },
      { id: 2, body: '<!-- revscope -->\n### old report', html_url: 'u2' },
    ]
    expect(findFarolComment(comments)?.id).toBe(2)
  })

  it('reads revscope.config.json when farol.config.json does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'farol-legacy-'))
    try {
      writeFileSync(join(dir, 'revscope.config.json'), '{"routes":{"file":"src/routes.tsx"}}')
      expect(loadConfig(dir, DEFAULT_CONFIG).path).toBe(join(dir, 'revscope.config.json'))
      writeFileSync(join(dir, 'farol.config.json'), '{"routes":{"file":"src/app.tsx"}}')
      expect(loadConfig(dir, DEFAULT_CONFIG).config.routes.file).toBe('src/app.tsx')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads analyze results written by revscope', () => {
    const json = JSON.parse(readFileSync(join(FIXTURES_DIR, '01-new-route', 'expected.json'), 'utf8')) as { tool: { name: string } }
    json.tool.name = 'revscope'
    expect(OutputSchema.safeParse(json).success).toBe(true)
  })
})
