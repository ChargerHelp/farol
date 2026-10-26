/* farol report, in the browser (3/3): what the change can affect, the API contract, the details of the analysis,
 * the results for the pull request, routing and events. Uses wb-core.js and wb-views.js. */
const compact = (n) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`)

/** Pages/operations the change can affect: try them by hand, or mark the ones that ship behind a feature flag. */
function renderOps(limit) {
  if (!OPS.length) return `<p class="muted">${t(T.plan.none, { many: TERM.many })}</p>`
  const tried = OPS.filter((o) => state.tested.includes(o.key)).length
  const flagged = OPS.filter((o) => isFlagged(o.key)).length
  const out = GROUPS.filter((g) => g.file && flagCovered(g.file) && !isReviewed(g.file))
  const row = (o) => {
    const done = state.tested.includes(o.key)
    const fl = isFlagged(o.key)
    const files = o.files.map((f) => `<span class="${flagCovered(f) ? 'gone' : ''}">${esc(base(f))}</span>`)
    const traffic = o.hits || o.errors ? `<span class="op-traffic">${[o.hits ? t(TERM.one === 'page' ? T.plan.views : T.plan.requests, { n: compact(o.hits) }) : '', o.errors ? (o.errorsUrl ? `<a href="${esc(o.errorsUrl)}" target="_blank" rel="noopener">${pl(o.errors, T.plan.errors)}</a>` : pl(o.errors, T.plan.errors)) : ''].filter(Boolean).join(' · ')}</span>` : ''
    return `<div class="op${done ? ' done' : ''}${fl ? ' flagged' : ''}"><label class="op-main"><input type="checkbox" data-test="${esc(o.key)}" ${done ? 'checked' : ''} aria-label="${esc(T.plan.triedBox)}">
      <span class="op-txt"><span class="op-path">${esc(o.path)}</span>${o.kind === 'new' ? `<span class="op-new">${T.plan.newTag}</span>` : ''}${traffic}
      <span class="op-via">${o.kind === 'new' ? T.plan.servedBy : T.plan.runs} ${files.slice(0, 2).join(', ')}${files.length > 2 ? ' ' + t(T.andMore, { n: files.length - 2 }) : ''}</span></span></label>
      <button type="button" class="op-flag" data-flag="${esc(o.key)}" aria-pressed="${fl}" title="${esc(t(T.plan.flagTitle, { one: TERM.one }))}">${fl ? T.plan.flagOn : T.plan.flagOff}</button></div>`
  }
  const first = OPS.slice(0, limit)
  const rest = OPS.slice(limit)
  return `<div class="ops-status"><span>${t(T.plan.tried, { done: tried, total: OPS.length })}</span><span>${t(T.plan.flagged, { n: flagged })}</span>${out.length ? `<span class="ops-out">${out.map((g) => t(T.plan.left, { file: esc(base(g.file)), points: POINTS0.get(g.id) ?? 0 })).join(' · ')}</span>` : ''}</div>
  <div class="ops-head"><span>${t(T.plan.head, { one: TERM.one })}</span><span>${T.plan.flagHead}</span></div>
  <div class="ops">${first.map(row).join('')}</div>
  ${rest.length ? `<details class="ops-more"><summary>${t(T.plan.more, { what: pl(rest.length, T.entriesPair) })}</summary><div class="ops">${rest.map(row).join('')}</div></details>` : ''}`
}

function planView() {
  const nNew = OPS.filter((o) => o.kind === 'new').length
  return `<h1>${T.plan.title}</h1><p class="lead">${t(T.plan.lead, { n: OPS.length - nNew, many: TERM.many, added: nNew ? t(T.plan.leadNew, { what: pl(nNew, T.newEntries) }) : '', one: TERM.one })}</p>
  <div class="opsbox">${renderOps(10)}</div>`
}

function contractView() {
  const list = D.contracts ?? []
  const ids = contractGroups.map((g) => g.id).join('|')
  const acked = contractGroups.length > 0 && contractGroups.every((g) => isAcked(g.id))
  const callers = (key) => { const c = D.callers[key]; return c?.length ? `<div class="small muted">${t(T.contract.callers, { services: c.map((x) => esc(x.service)).join(', ') })}</div>` : '' }
  const row = (e) => `<div class="contract"><span class="k">${esc(e.key)}</span>${e.level !== 'safe' ? `<span class="pill">${esc(T.contract.levels[e.level])}</span>` : ''}${callers(e.key)}<ul>${e.changes.map((c) => `<li class="${c.level}"><span class="w">${esc(c.where)}</span><span class="d">${esc(c.detail)}</span></li>`).join('')}</ul>${e.omitted ? `<div class="small muted">${t(T.andMore, { n: e.omitted })}</div>` : ''}</div>`
  const bad = list.filter((e) => e.level !== 'safe')
  return `<h1>${T.contract.title}</h1><p class="lead">${T.contract.lead}</p>
  ${contractGroups.length ? `<label class="ack big"><input type="checkbox" data-ack="${esc(ids)}" ${acked ? 'checked' : ''}> ${T.contract.ack}</label>` : ''}
  <h2>${T.contract.breaking}</h2>${bad.map(row).join('') || `<p class="muted">${T.none}</p>`}<h2>${T.contract.safe}</h2>${list.filter((e) => e.level === 'safe').map(row).join('') || `<p class="muted">${T.none}</p>`}`
}

/** The full analysis (routes, reach, signals, dependencies, reasons, diagnostics), in a frame of its own. */
function detailsView() {
  return `<h1>${T.details.title}</h1><p class="lead">${T.details.lead}</p><iframe class="details-frame" id="details-frame" title="${esc(T.details.title)}"></iframe>`
}
function fillDetails() {
  const frame = document.getElementById('details-frame')
  const src = document.getElementById('farol-details')
  if (!frame || !src) return
  const html = JSON.parse(src.textContent)
  const theme = document.documentElement.dataset.theme
  frame.srcdoc = theme ? html.replace('<html ', `<html data-theme="${theme}" `) : html
}
window.addEventListener('farol-theme', () => { if (ui.view === 'details') fillDetails() })

/** Just for curiosity: how much of the pull request needed a careful read, and the time that saves. */
function savedTime() {
  const lines = new Map(D.allFiles.map((f) => [f.path, f.added + f.removed]))
  const total = [...lines.values()].reduce((a, b) => a + b, 0)
  if (!total) return ''
  const needed = new Set([...FILES.filter((f) => tierOf(f) === 'high' || tierOf(f) === 'medium').map((f) => f.path), ...MUST.filter((g) => g.owner).map((g) => g.owner)])
  const read = [...needed].reduce((a, p) => a + (lines.get(p) ?? 0), 0)
  const PACE = 400 // lines an hour: the usual upper bound of a careful code review
  const time = (n) => { const m = Math.max(1, Math.round((n / PACE) * 60)); return m < 60 ? t(T.results.minutes, { m }) : t(T.results.hours, { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') }) }
  return `<div class="saved"><div class="big">${pct(read / total)}</div><p>${t(T.results.saved, { read, total, files: needed.size, all: D.allFiles.length, pace: PACE, time: time(read), full: time(total) })}</p>
    <div class="bar track"><span style="width:${(read / total) * 100}%"></span></div><small>${T.results.curiosity}</small></div>`
}

/** Everything the reviewer did, as GitHub Markdown for a pull request comment. */
function resultsMd() {
  const s = liveScore()
  const code = (x) => '`' + x + '`'
  const L = [T.md.title, '', t(T.md.score, { from: SCORE0, to: s, level: T.levels[levelOf(s)].toLowerCase() }), '']
  const must = mustList()
  if (must.length) {
    L.push(T.md.must)
    for (const m of must) {
      const g = m.groups[0]
      const what = m.contract ? t(T.md.contract, { keys: breakingKeys().map(code).join(', ') }) : g.owner ? t(g.items[0].kind === 'security' ? T.md.security : T.md.lint, { where: code(`${short(g.owner)}:${findingLine(g)}`) }) : g.items[0].title
      L.push(`- [${mustDone(m) ? 'x' : ' '}] ${what}`)
    }
    L.push('')
  }
  L.push(t(T.md.files, { done: FILES.filter(fileDone).length, total: FILES.length }))
  for (const x of filesByTier()) L.push(`- ${x.label}: ${x.files.filter(fileDone).length}/${x.files.length}`)
  const left = FILES.filter((f) => !fileDone(f) && (tierOf(f) === 'high' || tierOf(f) === 'medium'))
  if (left.length) L.push('', t(T.md.left, { files: left.slice(0, 10).map((f) => code(base(f.path))).join(', ') + (left.length > 10 ? ' ' + t(T.andMore, { n: left.length - 10 }) : '') }))
  const flaggedFiles = FILES.filter((f) => flagCovered(f.path) && !isReviewed(f.path))
  if (flaggedFiles.length) L.push(t(T.md.flaggedFiles, { files: flaggedFiles.map((f) => code(base(f.path))).join(', ') }))
  if (OPS.length) {
    const tried = OPS.filter((o) => state.tested.includes(o.key))
    L.push('', t(T.md.tried, { done: tried.length, total: OPS.length, many: TERM.many }))
    for (const o of tried.slice(0, 15)) L.push(`- [x] ${code(o.path)}${isFlagged(o.key) ? ' ' + T.md.behindFlag : ''}`)
    for (const o of OPS.filter((x) => isFlagged(x.key) && !state.tested.includes(x.key)).slice(0, 15)) L.push(`- ${T.md.flagged} ${code(o.path)}`)
  }
  if (S) L.push('', t(T.md.coverage, { ratio: pct(S.ratio), covered: S.covered, total: S.total }) + (S.missing.length ? t(T.md.coverageWithout, { ratio: pct(S.reportedRatio), files: pl(S.missing.length, T.files) }) : '') + '.')
  const notes = Object.entries(state.notes).filter(([, v]) => v.trim())
  if (notes.length) { L.push('', T.md.notes); for (const [p, v] of notes) L.push(`- ${code(short(p))}: ${v.trim().replace(/\s*\n\s*/g, ' ')}`) }
  L.push('', `<sub>${t(T.md.footer, { version: D.version, base: D.base, head: D.head })}</sub>`)
  return L.join('\n')
}
function resultsView() {
  return `<div class="results"><h1>${T.results.title}</h1><p class="lead">${T.results.lead}</p>${savedTime()}
  <div class="btns"><button class="primary" data-copyresults>${T.results.copy}</button>${D.links.pr ? `<a class="secondary" href="${esc(D.links.pr)}" target="_blank" rel="noopener">${T.results.openPr}</a>` : ''}</div>
  <pre>${esc(resultsMd())}</pre></div>`
}
async function copyResults() {
  const text = resultsMd()
  try { await navigator.clipboard.writeText(text) } catch {
    const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); document.execCommand('copy'); area.remove()
  }
  document.querySelectorAll('[data-copyresults]').forEach((b) => { const was = b.textContent; b.textContent = T.results.copied; setTimeout(() => { b.textContent = was }, 1600) })
}

function render() {
  ui.view = decodeURIComponent(location.hash.slice(1)) || 'summary'
  const railEl = document.getElementById('rail')
  const y = railEl.scrollTop
  rail()
  railEl.scrollTop = y
  const v = ui.view
  document.getElementById('main').innerHTML = v.startsWith('file:') ? fileView(v.slice(5)) : v.startsWith('finding:') ? findingView(v.slice(8)) : v === 'contract' ? contractView() : v === 'plan' ? planView() : v === 'details' ? detailsView() : v === 'results' ? resultsView() : summary()
  if (v === 'details') fillDetails()
}
addEventListener('hashchange', () => { render(); scrollTo(0, 0) })
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-copyresults]')) { copyResults(); return }
  const flag = e.target.closest('[data-flag]'); if (flag) { toggle('flagged', flag.dataset.flag); return }
  const r = e.target.closest('[data-review]'); if (r) { toggle('reviewed', r.dataset.review); return }
  const g = e.target.closest('[data-go]'); if (g) location.hash = 'file:' + g.dataset.go
})
document.addEventListener('toggle', (e) => {
  if (e.target.id === 'cov-d') { ui.covOpen = e.target.open; const h = e.target.querySelector('.clickhint'); if (h) h.textContent = ui.covOpen ? T.cov.hide : T.cov.show }
  const id = e.target.dataset?.tier; if (id) { if (e.target.open) ui.tierOpen.add(id); else ui.tierOpen.delete(id) }
}, true)
document.addEventListener('change', (e) => {
  const el = e.target
  if (el.dataset.reviewCb) { toggle('reviewed', el.dataset.reviewCb, el.checked); return }
  if (el.dataset.ack) { el.dataset.ack.split('|').forEach((id) => setIn('acked', id, el.checked)); emit(); return }
  if (el.dataset.test) toggle('tested', el.dataset.test, el.checked)
})
document.addEventListener('input', (e) => {
  const p = e.target.dataset?.note
  if (p === undefined) return
  state.notes = Object.fromEntries(Object.entries({ ...state.notes, [p]: e.target.value }).filter(([, v]) => v.trim()))
  save()
})
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return
  const order = ['summary', ...mustList().map((m) => (m.contract ? 'contract' : 'finding:' + m.groups[0].id)), ...FILES.map((f) => 'file:' + f.path)]
  const i = order.indexOf(ui.view)
  if (e.key === 'j' && i < order.length - 1) location.hash = order[i + 1]
  if (e.key === 'k' && i > 0) location.hash = order[i - 1]
  if (e.key === 'r' && ui.view.startsWith('file:')) toggle('reviewed', ui.view.slice(5))
})
initTheme(document.getElementById('theme'))
onChange(render)
render()
