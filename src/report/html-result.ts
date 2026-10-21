import type { Output } from '../output/schema.js'
import { mergeScore } from './merge-score.js'
import { HTML_TEXT as T, PLAN_TEXT as P, RESULT_TEXT as R, terms } from './strings.js'
import { computeVerdict } from './verdict.js'

/** JSON inside a <script> element: `<` escaped so the text can never close the element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

/**
 * The Result tab: a Markdown record of what the reviewer marked (flags, reviewed files, checked findings and contract
 * changes) with the initial and current risk, built in the page by RESULT_SCRIPT from the review state.
 */
export function resultSection(o: Output): string {
  const score = mergeScore(o)
  const verdict = computeVerdict(o)
  const commit = (o.head.sha ?? o.head.ref).slice(0, 12)
  const data = {
    of: R.of(o.repo ?? '', o.pr === null ? '' : `#${o.pr}`, commit),
    version: o.tool.version,
    verdict: P.levels[verdict.level],
    score: String(score.score),
    level: T.severity[score.level],
    many: terms(o.surface).many,
    security: o.signals.security.findings.map((f) => ({ id: `security:${f.path}:${f.line}:${f.rule}`, label: `${f.path}:${f.line} ${f.severity} ${f.rule}` })),
    vulns: o.signals.vulnerabilities.related.map((r) => ({ id: `vuln:${r.package}:${r.id}`, label: `${r.package} ${r.severity} ${r.id}` })),
    contracts: (o.contracts?.entries ?? []).filter((e) => e.level !== 'safe').map((e) => ({ id: `contract:${e.key}`, label: `${e.key} (${e.level})` })),
    t: {
      heading: R.heading,
      initial: R.initial,
      now: R.now,
      score: R.score('{score}', '{level}'),
      files: R.files('{done}', '{total}'),
      entries: R.entries('{left}', '{total}', '{many}'),
      flagged: R.flagged('{n}'),
      flaggedFiles: R.flaggedFiles('{n}'),
      reviewed: R.reviewed('{n}'),
      security: R.security('{done}', '{total}'),
      vulns: R.vulns('{done}', '{total}'),
      contracts: R.contracts('{done}', '{total}'),
      nothing: R.nothing,
      more: R.more('{n}'),
      footer: R.footer('{version}'),
    },
  }
  return `<section class="panel"><p class="small muted">${R.intro}</p><div class="result-tools"><button type="button" id="result-copy">${R.copy}</button><span class="small" id="result-copied" hidden>${R.copied}</span></div><pre class="result-text" id="result-text"></pre><script type="application/json" id="result-data">${scriptJson(data)}</script></section>`
}

/**
 * Builds the Result record from the review state (window.farolState, set by the review script before it announces a
 * change) and the score card. Must come after SCORE_SCRIPT and before REVIEW_SCRIPT.
 */
export const RESULT_SCRIPT = `<script>
(() => {
  const data = document.getElementById('result-data')
  if (!data) return
  const d = JSON.parse(data.textContent)
  const out = document.getElementById('result-text')
  const fill = (text, values) => text.replace(/\\{(\\w+)\\}/g, (m, k) => (values[k] === undefined ? m : String(values[k])))
  const code = (text) => '\`' + String(text).replaceAll('\`', "'") + '\`'
  const bullets = (items, max) => [...items.slice(0, max).map((x) => '- ' + code(x)), ...(items.length > max ? ['- ' + fill(d.t.more, { n: items.length - max })] : [])]
  const checks = (title, list, acks) => {
    if (list.length === 0) return []
    const done = list.filter((x) => acks.has(x.id)).length
    return ['', '**' + fill(title, { done, total: list.length }) + '**', ...list.map((x) => '- [' + (acks.has(x.id) ? 'x' : ' ') + '] ' + code(x.label))]
  }
  const pathOf = (key) => {
    for (const b of document.querySelectorAll('button.flag-toggle')) {
      if (b.dataset.flagKey !== key) continue
      const path = b.parentElement && b.parentElement.querySelector('.route-path')
      if (path) return path.textContent
    }
    return key
  }
  const render = () => {
    const st = window.farolState || { ticked: [], covered: [], flagged: [], acks: [], left: 0, total: 0, files: 0 }
    const acks = new Set(st.acks)
    const score = (document.getElementById('score-value') || {}).textContent || d.score
    const level = (document.getElementById('score-level') || {}).textContent || d.level
    const done = new Set([...st.ticked, ...st.covered]).size
    const lines = [d.t.heading + ' — ' + d.of, '']
    lines.push('- **' + d.t.initial + ':** ' + d.verdict + ' · ' + fill(d.t.score, { score: d.score, level: d.level }))
    const now = [fill(d.t.score, { score, level })]
    if (st.files > 0) now.push(fill(d.t.files, { done, total: st.files }))
    if (st.total > 0) now.push(fill(d.t.entries, { left: st.left, total: st.total, many: d.many }))
    lines.push('- **' + d.t.now + ':** ' + now.join(' · '))
    const outOfReview = st.covered.filter((f) => !st.ticked.includes(f)).length
    if (st.flagged.length > 0) lines.push('', '**' + fill(d.t.flagged, { n: st.flagged.length }) + '**' + (outOfReview > 0 ? ' — ' + fill(d.t.flaggedFiles, { n: outOfReview }) : ''), ...bullets(st.flagged.map(pathOf), 30))
    if (st.ticked.length > 0) lines.push('', '**' + fill(d.t.reviewed, { n: st.ticked.length }) + '**', ...bullets(st.ticked, 30))
    lines.push(...checks(d.t.security, d.security, acks), ...checks(d.t.vulns, d.vulns, acks), ...checks(d.t.contracts, d.contracts, acks))
    if (st.flagged.length + st.ticked.length + st.acks.length === 0) lines.push('', d.t.nothing)
    lines.push('', fill(d.t.footer, { version: d.version }))
    out.textContent = lines.join('\\n')
    const badge = document.getElementById('result-count')
    if (badge) {
      const n = st.flagged.length + st.ticked.length + st.acks.length
      badge.textContent = String(n)
      badge.hidden = n === 0
    }
  }
  document.addEventListener('farol-reviewed', render)
  document.getElementById('result-copy').addEventListener('click', async () => {
    const text = out.textContent
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // No clipboard permission (file:// pages in some browsers): select the text for a manual copy.
      const range = document.createRange()
      range.selectNodeContents(out)
      const sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('copy')
    }
    const copied = document.getElementById('result-copied')
    copied.hidden = false
    setTimeout(() => { copied.hidden = true }, 1800)
  })
  render()
})()
</script>`
