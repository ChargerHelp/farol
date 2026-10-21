import { ASSETS } from './html-assets.js'

function asset(name: string): string {
  const svg = ASSETS[name]
  if (svg === undefined) throw new Error(`internal: logo asset ${name} is missing (npm run assets)`)
  return svg
}

/** An asset ready to inline: comments and indentation removed, sized by CSS instead of 100%. */
function compact(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(' width="100%" height="100%"', '')
    .trim()
}

/** Where the mark and the wordmark sit in the 520×160 artboard of the horizontal logo (the rest is padding). */
const LOGO_CONTENT = '18 20 320 104'

/** The horizontal logo (mark and wordmark), cropped to its content and without its background rectangle. */
export function logoSvg(theme: 'light' | 'dark'): string {
  const svg = compact(asset(`farol-horizontal-${theme}.svg`))
    .replace(/<rect width="520" height="160" fill="#[0-9A-Fa-f]{6}"\s*\/>/, '')
    .replace('viewBox="0 0 520 160"', `viewBox="${LOGO_CONTENT}"`)
  return svg.replace('<svg ', '<svg role="img" aria-label="farol" focusable="false" ')
}

/** The square icon as a data URI, for the page's favicon. */
export function faviconUri(theme: 'light' | 'dark'): string {
  return `data:image/svg+xml;base64,${Buffer.from(compact(asset(`farol-favicon-${theme}.svg`))).toString('base64')}`
}
