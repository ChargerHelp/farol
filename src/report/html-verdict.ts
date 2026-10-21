import type { Output } from '../output/schema.js'
import { scoreBox, type ScoreRenderer } from './html-score.js'
import { diffBlock } from './html-diff.js'
import { CLASS_TEXT, CONTRACT_TEXT as CT, OWNER_TEXT as O, PLAN_TEXT as P, USAGE_TEXT as U, terms } from './strings.js'
import { compactNumber, datadogErrorsUrl, usageHits, usageSummary } from './usage.js'
import { computeVerdict, type FileToReview, type Verdict } from './verdict.js'

/** What the plan needs from the page renderer: file links and the raw diff URL of a file. */
export interface PlanRenderer extends ScoreRenderer {
  url(path: string): string | null
}

function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

const pill = (text: string, cls = '', title = ''): string => `<span class="pill ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`

function coveragePill(f: FileToReview, verified: boolean): string {
  if (!verified) return pill(P.coverageUnverified, 'warn')
  if (f.coverage === undefined || f.coverage.ratio === null) return pill(P.coverageNone, '', f.coverage?.label ?? '')
  const r = f.coverage.ratio
  return pill(P.covered(Math.round(r * 100)), r < 0.5 ? 'bad' : r < 0.8 ? 'warn' : 'good', f.coverage.label)
}

function ownerPill(f: FileToReview, o: Output): string {
  const owner = o.ownership?.files.find((x) => x.path === f.path)
  return owner === undefined ? '' : pill(O.owner(owner.owner, owner.share), 'owner', O.ownerTitle)
}

function trafficPill(f: FileToReview, o: Output): string {
  const usage = usageSummary(o)
  if (usage === null) return ''
  const { byPath } = usageHits(o)
  const hits = f.entries.reduce((n, p) => n + (byPath.get(p) ?? 0), 0)
  const traffic = hits > 0 ? pill(U.pill(compactNumber(hits), usage.kind), 'traffic', U.pillTitle(usage.days)) : ''
  const errors = o.usage?.files.find((e) => e.path === f.path)
  if (!errors) return traffic
  const url = datadogErrorsUrl(o, errors.issueIds, errors.track ?? (o.surface === 'backend' ? 'trace' : 'rum'))
  const label = pill(U.filePill(compactNumber(errors.errors)), 'bad', U.filePillTitle(errors.issues, errors.types.join(', '), usage.days))
  return `${traffic}${url === null ? label : `<a class="pill-link" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`}`
}

/** One file to review: what changed, why it matters (reach, coverage, findings) and its risk points. */
function fileRow(f: FileToReview, o: Output, h: PlanRenderer, verified: boolean): string {
  const t = terms(o.surface)
  const pills = [
    f.pagesReached > 0 ? pill(P.reach(f.pagesReached, o.risk.totalPages, t.many), f.level === 'high' ? 'bad' : 'warn') : '',
    trafficPill(f, o),
    ownerPill(f, o),
    coveragePill(f, verified),
    f.security > 0 ? pill(P.security(f.security), 'bad') : '',
    f.lint > 0 ? pill(P.lint(f.lint), 'bad') : '',
    f.suppressions > 0 ? pill(P.suppressions(f.suppressions), 'warn') : '',
  ].join('')
  const level = f.points >= 30 ? 'high' : f.points >= 12 ? 'medium' : 'low'
  return `<li class="file-row" data-file="${esc(f.path)}" data-entries="${esc(f.entries.join('|'))}"><input type="checkbox" class="row-review" data-review-file="${esc(f.path)}" title="${esc(P.markReviewed)}">
<div class="file-main"><div>${h.path(f.path)}<span class="flag-note"></span>${f.change ? ` <span class="tag ${f.change === 'added' ? 'added' : f.change === 'deleted' ? 'deleted' : ''}">${esc(f.change)}</span>` : ''}</div>${f.why ? `<div class="small muted">${esc(f.why)}</div>` : ''}</div>
<div class="file-pills">${pills}</div><div class="file-points ${level}" title="${esc(P.pointsTitle)}">${f.points}</div>${diffBlock(o, f.path, h.url(f.path))}</li>`
}

function otherList(v: Verdict, h: PlanRenderer): string {
  if (v.other.length === 0) return ''
  const groups = (['not-code', 'dependency', 'test'] as const).map((k) => ({ k, files: v.other.filter((o) => o.kind === k) })).filter((g) => g.files.length > 0)
  const body = groups.map((g) => `<div class="other-group"><div class="small muted">${P.otherKinds[g.k]} (${g.files.length})</div><div class="finding-files">${g.files.map((f) => h.path(f.path)).join('')}</div></div>`).join('')
  return `<details class="plan-more"><summary>${P.otherTitle(v.other.length)}</summary><p class="small muted">${P.otherIntro}</p>${body}</details>`
}

/** Environment, infrastructure and CI files: a section of their own, open, since deployments run them. */
function infraList(v: Verdict, o: Output, h: PlanRenderer): string {
  if (v.infra.length === 0) return ''
  const rows = v.infra.map((p) => `<li class="file-row compact-row" data-file="${esc(p)}"><input type="checkbox" class="row-review" data-review-file="${esc(p)}" title="${esc(P.markReviewed)}"><div class="file-main">${h.path(p)}</div><div class="file-pills"></div><div></div>${diffBlock(o, p, h.url(p))}</li>`)
  return `<h3>${P.infraTitle(v.infra.length)} <span class="muted small">${P.infraHint}</span></h3><ol class="file-list compact">${rows.join('\n')}</ol>`
}

function facts(o: Output, v: Verdict): string {
  const t = terms(o.surface)
  const affected = o.routes.affected.filter((r) => !r.hasChildren).length
  const cov = o.signals.coverage.total
  const ratio = cov && cov.changedExecutableLines > 0 ? cov.coveredLines / cov.changedExecutableLines : null
  const security = o.signals.security.findings.length
  const critical = o.dependencies.summary.critical + o.signals.vulnerabilities.related.filter((r) => r.severity === 'critical' || r.severity === 'high').length
  const lint = o.signals.lint.changedLines?.errors
  const link = (href: string, text: string, cls = ''): string => `<a class="fact ${cls}" href="#${href}">${esc(text)}</a>`
  return `<div class="facts"><span class="badge small-badge ${o.classification}" title="${esc(`${CLASS_TEXT[o.classification]} — ${P.classTitle}`)}">${esc(o.classification)}</span>
${link('files', P.codeFiles(v.startHere.length + v.skim.length, v.other.length + v.infra.length))}
${link('routes', P.affected(affected, o.routes.added.length, t.many), affected > 0 ? 'warn' : '')}
${traffic(o, link)}
${contractFact(o, link)}
${link('signals', ratio === null ? P.coverageFact(null) : P.coverageFact(Math.round(ratio * 100)), ratio === null ? '' : ratio < 0.5 ? 'bad' : ratio < 0.8 ? 'warn' : 'good')}
${link('security', P.securityFact(security), security > 0 ? 'bad' : '')}
${link('dependencies', P.dependencyFact(critical), critical > 0 ? 'bad' : '')}
${lint === undefined ? '' : link('lint', P.lintFact(lint), lint > 0 ? 'bad' : '')}</div>`
}

function traffic(o: Output, link: (href: string, text: string, cls?: string) => string): string {
  const usage = usageSummary(o)
  if (usage === null) return o.usage?.status === 'error' ? `<span class="fact warn" title="${esc(U.error(o.usage.message ?? ''))}">${esc(U.fact(null, o.usage.kind))}</span>` : ''
  const files = o.usage?.files.length ?? 0
  const share = link('routes', U.fact(usage.share, usage.kind), usage.share !== null && usage.share >= 20 ? 'warn' : '').replace('<a ', `<a title="${esc(U.factTitle(usage.source, usage.days))}" `)
  return files === 0 ? share : `${share}\n${link('files', U.filesFact(files), 'bad')}`
}

function contractFact(o: Output, link: (href: string, text: string, cls?: string) => string): string {
  const c = o.contracts?.summary
  if (c === undefined) return ''
  if (c.breaking > 0) return link('contracts', CT.fact(c.breaking), 'bad')
  if (c.dangerous > 0) return link('contracts', CT.factDangerous(c.dangerous), 'warn')
  return ''
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

/** Filter of the files by the page/operation they reach (paths offered as suggestions). */
function entryFilter(o: Output): string {
  const paths = [...new Set([...o.routes.affected, ...o.routes.added].filter((r) => !r.hasChildren).map((r) => r.path))].sort()
  if (paths.length === 0) return ''
  const t = terms(o.surface)
  return `<div class="entry-filter"><input type="search" id="entry-filter" list="entry-options" placeholder="${esc(P.entryFilter(t.one))}" spellcheck="false"><datalist id="entry-options">${paths.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist><button type="button" id="entry-filter-clear">${P.entryFilterClear}</button><span class="small muted" id="entry-filter-count" data-template="${esc(P.entryFilterCount)}"></span></div>`
}

/**
 * The first thing on the page: how much review the PR needs and where to start. Files are ordered by their own risk
 * points; ticking one marks it reviewed (same state as the "Mark files as reviewed" panel).
 */
export function reviewPlan(o: Output, h: PlanRenderer): string {
  const v = computeVerdict(o)
  const verified = o.signals.coverage.status === 'ok'
  const start = v.startHere.length === 0 ? `<p class="muted">${P.nothingToStart}</p>` : `<ol class="file-list">${v.startHere.map((f) => fileRow(f, o, h, verified)).join('\n')}</ol>`
  const skim = v.skim.length === 0 ? '' : `<details class="plan-more"><summary>${P.skimTitle(v.skim.length)}</summary><ol class="file-list compact">${v.skim.map((f) => fileRow(f, o, h, verified)).join('\n')}</ol></details>`
  const incremental = o.incremental ? `<p class="incremental">${esc(P.incremental(o.incremental.since.slice(0, 12)))}</p>` : ''
  return `<section class="panel plan plan-${v.level}" id="plan">${incremental}<div class="plan-head"><div class="plan-verdict">
<div class="muted small">${P.title}</div><div class="plan-title">${P.levels[v.level]}</div><p class="plan-advice">${P.advice[v.level]}</p>
<ul class="plan-reasons">${v.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>${scoreBox(o, h)}</div>
${facts(o, v)}
<h3>${P.startTitle} <span class="muted small">${P.startHint}</span></h3>${entryFilter(o)}${start}${skim}${infraList(v, o, h)}${otherList(v, h)}</section>`
}
