/** Inline scripts of the HTML report: the only behavior of the page. */
import { HTML_TEXT as T } from './strings.js'

/** Exact version: the report must render the same diagrams whenever it is opened. */
export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs'
/** highlight.js common build (ES module), exact version; loaded only when a diff is opened. */
export const HIGHLIGHT_URL = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/es/highlight.min.js'

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

/**
 * Merge risk score of the overview: recomputed from the contributors that are left when files are marked as reviewed
 * (event from REVIEW_SCRIPT, which must come after this script). Same formula as combineScore in merge-score.ts.
 */
export const SCORE_SCRIPT = `<script>
(() => {
  const card = document.getElementById('merge-score')
  if (!card) return
  const drivers = [...card.querySelectorAll('#score-drivers li')].map((li) => ({ li, file: li.dataset.file, weights: li.dataset.weights.split(',').map(Number) }))
  const combine = (groups) => Math.round(100 * (1 - groups.reduce((p, g) => g.weights.reduce((q, w) => q * (1 - w), p), 1)))
  const initial = combine(drivers)
  const high = Number(card.dataset.high)
  const medium = Number(card.dataset.medium)
  const shown = Number(card.dataset.shown)
  const names = { high: '${T.severity.high}', medium: '${T.severity.medium}', low: '${T.severity.low}' }
  document.addEventListener('farol-reviewed', (event) => {
    const reviewed = new Set(event.detail)
    const left = drivers.filter((d) => d.file === '' || !reviewed.has(d.file))
    const score = combine(left)
    const level = score >= high ? 'high' : score >= medium ? 'medium' : 'low'
    document.getElementById('score-value').textContent = String(score)
    card.querySelector('.score-value').className = 'score-value ' + level
    const chip = document.getElementById('score-level')
    chip.className = 'chip ' + level
    chip.textContent = names[level]
    const bar = document.getElementById('score-bar')
    bar.className = 'bar score-bar ' + (level === 'high' ? 'bad' : level === 'medium' ? 'warn' : '')
    bar.firstElementChild.style.width = score + '%'
    const done = drivers.filter((d) => d.file !== '' && reviewed.has(d.file)).length
    document.getElementById('score-reviewed').textContent = done === 0 ? '' : '${T.scoreReviewed}'.replace('{files}', done).replace('{initial}', initial)
    // Progress is linear in the weights (the score itself saturates when many risky files are left).
    const weight = (list) => list.reduce((n, d) => n + d.weights.reduce((m, w) => m + w, 0), 0)
    const reviewable = weight(drivers.filter((d) => d.file !== ''))
    const progress = document.getElementById('score-progress')
    progress.hidden = done === 0 || reviewable === 0
    progress.textContent = progress.dataset.template.replace('{percent}', reviewable === 0 ? 0 : Math.round((100 * weight(drivers.filter((d) => d.file !== '' && reviewed.has(d.file)))) / reviewable))
    // Contributors keep their order (each one's own risk); reviewed ones leave the list.
    left.forEach((d, i) => { d.li.hidden = i >= shown })
    for (const d of drivers) if (!left.includes(d)) d.li.hidden = true
    const more = document.getElementById('score-more')
    more.hidden = left.length <= shown
    more.textContent = more.dataset.template.replace('{n}', left.length - shown)
  })
})()
</script>`

/**
 * Checkboxes of the review plan rows: they tick the same file in the "Mark files as reviewed" panel (one state), and
 * follow it. Must come before REVIEW_SCRIPT, whose first pass announces the saved state.
 */
export const PLAN_SCRIPT = `<script>
(() => {
  const rows = [...document.querySelectorAll('.file-row')]
  if (rows.length === 0) return
  const panelBox = (file) => [...document.querySelectorAll('#review input[data-file]')].find((b) => b.dataset.file === file)
  for (const row of rows) {
    const box = row.querySelector('input[data-review-file]')
    const target = panelBox(box.dataset.reviewFile)
    if (!target) {
      box.hidden = true
      continue
    }
    box.addEventListener('change', () => {
      target.checked = box.checked
      target.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  document.addEventListener('farol-reviewed', (event) => {
    const reviewed = new Set(event.detail)
    for (const row of rows) {
      const box = row.querySelector('input[data-review-file]')
      const done = reviewed.has(box.dataset.reviewFile)
      box.checked = done
      row.classList.toggle('is-reviewed', done)
      // Covered by a feature flag (set by the review script): nothing to tick.
      box.disabled = row.classList.contains('is-flagged')
    }
  })
})()
</script>`

/**
 * Manual test checklist: ticks kept per commit in localStorage (when available), progress shown on top. Items whose
 * changed files are all reviewed follow the review state (event "farol-reviewed", window.farolState).
 */
export const TEST_SCRIPT = `<script>
(() => {
  const panel = document.getElementById('test-plan-panel')
  if (!panel) return
  const review = document.getElementById('review')
  const storageKey = 'farol-tested:' + (review ? review.dataset.key : location.pathname)
  const boxes = [...panel.querySelectorAll('input[data-test-key]')]
  try {
    const saved = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'))
    for (const box of boxes) box.checked = saved.has(box.dataset.testKey)
  } catch {}
  // Items whose changed files are all reviewed (or out of the review behind a flag) look like reviewed files.
  let reviewedItems = 0
  const mark = (state) => {
    if (!state) return
    const ticked = new Set(state.ticked)
    const out = new Set([...state.ticked, ...state.covered])
    const flagged = new Set(state.flagged)
    reviewedItems = 0
    for (const item of panel.querySelectorAll('li.test-item')) {
      const files = item.dataset.files ? item.dataset.files.split('|') : []
      const reviewed = files.length > 0 && files.every((f) => ticked.has(f))
      const isFlagged = !reviewed && (flagged.has(item.dataset.key) || (files.length > 0 && files.every((f) => out.has(f))))
      item.classList.toggle('is-reviewed', reviewed)
      item.classList.toggle('is-flagged', isFlagged)
      const note = item.querySelector('.flag-note')
      note.textContent = reviewed ? panel.dataset.reviewedNote : isFlagged ? panel.dataset.flagNote : ''
      note.title = reviewed ? panel.dataset.reviewedTitle : isFlagged ? panel.dataset.flagTitle : ''
      if (reviewed || isFlagged) reviewedItems++
    }
    apply()
  }
  document.addEventListener('farol-reviewed', () => mark(window.farolState))
  const apply = () => {
    const done = boxes.filter((b) => b.checked)
    document.getElementById('test-progress').textContent = panel.dataset.template.replace('{done}', done.length).replace('{total}', boxes.length) + (reviewedItems > 0 ? panel.dataset.reviewedTemplate.replace('{n}', reviewedItems) : '')
    for (const group of panel.querySelectorAll('details.test-group')) {
      const own = [...group.querySelectorAll('input[data-test-key]')]
      const count = group.querySelector('.test-count')
      count.textContent = own.filter((b) => b.checked).length + ' / ' + own.length
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(done.map((b) => b.dataset.testKey)))
    } catch {}
  }
  panel.addEventListener('change', apply)
  apply()
})()
</script>`

/**
 * Syntax highlighting of the inline diffs: highlight.js is loaded the first time a diff opens, and each line is
 * highlighted on its own (the language comes from the file extension). Without network the diff stays plain.
 */
export const HIGHLIGHT_SCRIPT = `<script type="module">
let hljs
async function highlight(details) {
  const table = details.querySelector('table[data-lang]')
  if (!table || table.dataset.highlighted) return
  try {
    if (!hljs) hljs = (await import('${HIGHLIGHT_URL}')).default
    const language = table.dataset.lang
    if (!hljs.getLanguage(language)) return
    for (const cell of table.querySelectorAll('.src')) cell.innerHTML = hljs.highlight(cell.textContent, { language, ignoreIllegals: true }).value
    table.dataset.highlighted = 'true'
  } catch (error) {
    console.warn('farol: could not highlight the diff', error)
  }
}
for (const details of document.querySelectorAll('details.inline-diff')) {
  details.addEventListener('toggle', () => { if (details.open) void highlight(details) })
}
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

/**
 * "Start here" filter by entry point: rows list the pages/operations their file reaches (data-entries); typing part
 * of one shows only the files that reach a match.
 */
export const ENTRY_FILTER_SCRIPT = `<script>
(() => {
  const input = document.getElementById('entry-filter')
  if (!input) return
  const plan = document.getElementById('plan')
  const rows = [...plan.querySelectorAll('.file-row')]
  const count = document.getElementById('entry-filter-count')
  const apply = () => {
    const query = input.value.trim().toLowerCase()
    let shown = 0
    for (const row of rows) {
      const entries = (row.dataset.entries || '').toLowerCase().split('|').filter((e) => e !== '')
      const visible = query === '' || entries.some((e) => e.includes(query))
      row.classList.toggle('filtered-out', !visible)
      if (visible) shown++
    }
    // Matches in collapsed lists (skim) open them.
    if (query !== '') for (const details of plan.querySelectorAll('details.plan-more')) if (details.querySelector('.file-row:not(.filtered-out)')) details.open = true
    count.textContent = query === '' ? '' : count.dataset.template.replace('{n}', shown)
  }
  input.addEventListener('input', apply)
  document.getElementById('entry-filter-clear').addEventListener('click', () => { input.value = ''; apply() })
})()
</script>`
