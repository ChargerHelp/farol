import type { Output } from '../output/schema.js'
import { CONTRACT_TEXT as C } from './strings.js'
import { compactNumber } from './usage.js'

type Entry = NonNullable<Output['contracts']>['entries'][number]

function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

const CHIP = { breaking: 'high', dangerous: 'medium', safe: 'low' } as const

/** "called by web-bff (12k), worker (300)" for an entry point, or why it is not known. */
export function callersText(o: Output, key: string): string {
  if (o.usage?.status !== 'ok') return C.callersUnknown
  const services = o.usage.callers.find((c) => c.key === key)?.services ?? []
  if (services.length === 0) return C.noCallers
  const shown = services.slice(0, 4).map((s) => `${s.service} (${compactNumber(s.hits)})`)
  return C.calledBy(`${shown.join(', ')}${services.length > 4 ? `, ${C.more(services.length - 4)}` : ''}`)
}

function entryRow(o: Output, e: Entry): string {
  const rows = e.changes.map((c) => `<tr><td><span class="chip ${CHIP[c.level]}">${C.levels[c.level]}</span></td><td><code>${esc(c.where)}</code></td><td>${esc(c.detail)}</td></tr>`).join('')
  const more = e.omitted > 0 ? `<p class="muted small">${esc(C.more(e.omitted))}</p>` : ''
  const first = e.changes[0]
  return `<details class="contract"><summary><span class="chip ${CHIP[e.level]}">${C.levels[e.level]}</span><code class="route-path">${esc(e.key)}</code><span class="small muted">${esc(first ? `${first.where}: ${first.detail}` : '')}${e.changes.length + e.omitted > 1 ? ` · ${esc(C.more(e.changes.length + e.omitted - 1))}` : ''}</span><span class="small contract-callers">${esc(callersText(o, e.key))}</span></summary>
<div class="contract-body"><table class="contract-table"><thead><tr><th>${C.columns.level}</th><th>${C.columns.where}</th><th>${C.columns.change}</th></tr></thead><tbody>${rows}</tbody></table>${more}</div></details>`
}

/** Contract changes of the backend's endpoints: breaking and dangerous first, safe-only ones collapsed. */
export function contractsSection(o: Output): string {
  const c = o.contracts
  if (c === undefined) return ''
  const notable = c.entries.filter((e) => e.level !== 'safe')
  const safe = c.entries.filter((e) => e.level === 'safe')
  const problem = c.problem === undefined ? '' : `<p class="warn small">${esc(c.problem)}</p>`
  const safeBlock = safe.length > 0 ? `<details class="plan-more"><summary>${esc(C.safeTitle(safe.length))}</summary>${safe.map((e) => entryRow(o, e)).join('\n')}</details>` : ''
  return `<section class="panel"><p class="small muted">${C.intro}</p>${problem}<p><strong>${esc(C.summary(c.summary.breaking, c.summary.dangerous, c.summary.safe))}</strong> <span class="muted small">· ${esc(C.readable(c.readable))}</span></p>${notable.map((e) => entryRow(o, e)).join('\n')}${safeBlock}</section>`
}
