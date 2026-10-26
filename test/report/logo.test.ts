import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSETS } from '../../src/report/html-assets.js'
import { renderHtml } from '../../src/report/html.js'
import { faviconUri, logoSvg } from '../../src/report/logo.js'
import { OutputSchema } from '../../src/output/schema.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

const ASSETS_DIR = join(import.meta.dirname, '..', '..', 'assets')

describe('logo', () => {
  it('embeds exactly the files of assets/ and assets/report/ (run npm run assets after changing them)', () => {
    const report = readdirSync(join(ASSETS_DIR, 'report')).filter((f) => f.endsWith('.js') || f.endsWith('.css')).map((f) => `report/${f}`)
    const files = [...readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.svg')), ...report].sort()
    expect(Object.keys(ASSETS).sort()).toEqual(files)
    for (const f of files) expect(ASSETS[f]).toBe(readFileSync(join(ASSETS_DIR, f), 'utf8'))
  })

  it('inlines the logo without comments or background, and the favicon as a data URI', () => {
    for (const theme of ['light', 'dark'] as const) {
      const svg = logoSvg(theme)
      expect(svg.startsWith('<svg role="img" aria-label="farol"')).toBe(true)
      expect(svg).not.toContain('<!--')
      expect(svg).not.toContain('<rect width="520" height="160"')
      expect(svg).not.toMatch(/<script|on\w+=|href="http/)
      expect(faviconUri(theme).startsWith('data:image/svg+xml;base64,')).toBe(true)
    }
  })

  it('shows the logo in the header and the favicon in the page', () => {
    const o = OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, '05-shared-component', 'expected.json'), 'utf8')))
    const html = renderHtml(o)
    expect(html).toContain('<span class="logo-light"><svg role="img" aria-label="farol"')
    expect(html).toContain('<span class="logo-dark"><svg role="img" aria-label="farol"')
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,')
  })
})
