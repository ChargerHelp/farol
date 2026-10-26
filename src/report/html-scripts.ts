/** Inline scripts of the HTML report: the only behavior of the page. */
import { HTML_TEXT as T } from './strings.js'

/** Exact version: the report must render the same diagrams whenever it is opened. */
export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs'

/** Filters of the Risk section: rows stay visible when their level and their change kind are both ticked. */
export const RISK_FILTER_SCRIPT = `<script>
(() => {
  const box = document.getElementById('risk-filters')
  if (!box) return
  const rows = [...document.querySelectorAll('#risk-table tbody tr[data-level]')]
  const count = document.getElementById('risk-count')
  const apply = () => {
    const on = (group) => new Set([...box.querySelectorAll('input[data-filter="' + group + '"]:checked')].map((i) => i.value))
    const levels = on('level')
    const changes = on('change')
    let shown = 0
    for (const row of rows) {
      const visible = levels.has(row.dataset.level) && changes.has(row.dataset.change)
      row.hidden = !visible
      if (visible) shown++
    }
    count.textContent = '${T.filterShowing}'.replace('{shown}', shown).replace('{total}', rows.length)
  }
  box.addEventListener('change', apply)
  apply()
})()
</script>`

/** Loads Mermaid only when a route row is opened; without network the import chains below stay readable. */
export const MERMAID_SCRIPT = `<script type="module">
const rows = document.querySelectorAll('details.route')
let mermaid
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
const configure = () => mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: isDark() ? 'dark' : 'default', flowchart: { useMaxWidth: true } })
// A theme change redraws the diagrams already drawn (Mermaid bakes the theme into the SVG).
document.addEventListener('farol-theme', () => {
  if (!mermaid) return
  configure()
  for (const row of rows) {
    const el = row.querySelector('pre.mermaid[data-processed]')
    if (!el || el.dataset.src === undefined) continue
    el.removeAttribute('data-processed')
    el.textContent = el.dataset.src
    if (row.open) void draw(row)
  }
})
async function draw(row) {
  const el = row.querySelector('pre.mermaid:not([data-processed])')
  if (!el) return
  try {
    if (!mermaid) {
      mermaid = (await import('${MERMAID_URL}')).default
      configure()
    }
    if (el.dataset.src === undefined) el.dataset.src = el.textContent
    await mermaid.run({ nodes: [el] })
    row.querySelector('.diagram-note')?.remove()
  } catch (error) {
    console.warn('farol: could not draw the route graph', error)
  }
}
rows.forEach((row) => {
  row.addEventListener('toggle', () => { if (row.open) void draw(row) })
  if (row.open) void draw(row)
})
</script>`

/** Light/dark switch: the choice is kept per viewer (localStorage when available) and overrides the system theme. */
export const THEME_SCRIPT = `<script>
(() => {
  const root = document.documentElement
  try {
    const saved = localStorage.getItem('farol-theme')
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved
  } catch {}
  const button = document.getElementById('theme-toggle')
  if (!button) return
  button.addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset.theme = dark ? 'light' : 'dark'
    try {
      localStorage.setItem('farol-theme', root.dataset.theme)
    } catch {}
    document.dispatchEvent(new Event('farol-theme'))
  })
})()
</script>`

/** Full-screen buttons of the diffs and the route graphs (Fullscreen API; Esc leaves). */
export const FULLSCREEN_SCRIPT = `<script>
(() => {
  const label = '${T.fullscreen}'
  const exit = '${T.exitFullscreen}'
  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('button.fullscreen')
    if (!button) return
    const target = button.closest('.fs-target')
    if (document.fullscreenElement === target) void document.exitFullscreen()
    else if (target && target.requestFullscreen) void target.requestFullscreen()
  })
  document.addEventListener('fullscreenchange', () => {
    for (const button of document.querySelectorAll('button.fullscreen')) {
      button.textContent = document.fullscreenElement && button.closest('.fs-target') === document.fullscreenElement ? exit : label
    }
  })
})()
</script>`

