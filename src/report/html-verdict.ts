import type { Output } from '../output/schema.js'
import { OWNER_TEXT as O, PLAN_TEXT as P } from './strings.js'

function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function ownership(o: NonNullable<Output['ownership']>): string {
  const base = (p: string): string => p.split('/').pop() ?? p
  const people = o.reviewers.map((r) => {
    const files = r.files.map((f) => `<span class="pill" title="${esc(f.path)}">${esc(O.file(base(f.path), f.share))}</span>`).join('')
    return `<li class="owner"><div class="owner-head"><strong>${esc(r.name)}</strong>${r.active ? '' : `<span class="pill warn" title="${esc(O.inactiveTitle)}">${O.inactive}</span>`}<span class="muted small" title="${esc(O.scoreTitle)}">${esc(O.score(r.score))}</span></div><div class="bar owner-bar"><span style="width:${Math.min(100, r.score)}%"></span></div><div class="owner-files">${files}</div></li>`
  })
  const owners = o.codeowners.length === 0 ? '' : `<p class="small"><span class="muted">${O.codeowners}:</span> ${o.codeowners.map((c) => `<span class="pill" title="${esc(c.files.join('\n'))}"><strong>${esc(c.name)}</strong> · ${esc(P.codeowner(c.files.length))}</span>`).join(' ')}</p>`
  return `<div class="ownership"><h3>${O.title} <span class="muted small">— ${esc(O.intro)}</span></h3>${people.length > 0 ? `<ol class="owners">${people.join('')}</ol>` : `<p class="muted small">${O.none}</p>`}${owners}</div>`
}

/** The Reviewers tab: reviewers by authorship (farol reviewers), else the recent committers of analyze --reviewers. */
export function reviewersSection(o: Output): string {
  const body = reviewers(o)
  return body === '' ? '' : `<section class="panel">${body}</section>`
}

function reviewers(o: Output): string {
  if (o.ownership !== undefined) return ownership(o.ownership)
  if (o.reviewers === undefined) return ''
  const list = o.reviewers.map((r) => `<span class="pill" title="${esc(r.files.join('\n'))}"><strong>${esc(r.name)}</strong> · ${esc(r.kind === 'codeowner' ? P.codeowner(r.files.length) : P.author(r.files.length, r.commits))}</span>`)
  return `<div class="reviewers small"><span class="muted">${P.reviewersTitle}:</span> ${list.length > 0 ? list.join(' ') : `<span class="muted">${P.noReviewers}</span>`}</div>`
}
