import type { Output } from '../output/schema.js'
import { FLAG_TEXT as F, TEST_TEXT as X, terms } from './strings.js'
import { shortFile, testPlan } from './test-plan.js'

function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** Groups opened at first; the others start collapsed. */
const OPEN_GROUPS = 3

/**
 * Manual test checklist of the pages/operations the PR adds or affects, grouped by module, riskiest first; ticks are
 * kept in this browser per commit (TEST_SCRIPT). Each item carries its changed files: reviewing all of them marks it.
 */
export function testPlanSection(o: Output): string {
  const t = terms(o.surface)
  const groups = testPlan(o)
  if (groups.length === 0) return `<section class="panel"><p class="muted">${X.none(t.many)}</p></section>`
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const body = groups
    .map((g, i) => {
      const items = g.items
        .map((item) => {
          const tag = item.kind === 'new' ? `<span class="tag added">${X.newTag}</span>` : `<span class="tag affected">${X.affectedTag}</span>`
          const because = item.because ? `<span class="muted small">${esc(item.kind === 'new' ? X.renders(shortFile(item.because)) : X.because(shortFile(item.because)))}</span>` : ''
          return `<li class="test-item" data-key="${esc(item.key)}" data-files="${esc(item.files.join('|'))}"><label><input type="checkbox" data-test-key="${esc(item.key)}"> ${tag} <code>${esc(item.path)}</code> ${because}<span class="flag-note"></span></label></li>`
        })
        .join('')
      return `<details class="test-group"${i < OPEN_GROUPS ? ' open' : ''}><summary><span class="tree-label">${esc(g.label)}</span> <span class="muted small test-count" data-total="${g.items.length}">${X.count(g.items.length)}</span></summary><ul class="test-list">${items}</ul></details>`
    })
    .join('\n')
  return `<section class="panel" id="test-plan-panel" data-template="${esc(X.progress)}" data-reviewed-template="${esc(X.reviewedProgress)}" data-reviewed-note="${esc(X.filesReviewed)}" data-reviewed-title="${esc(X.filesReviewedTitle)}" data-flag-note="${esc(F.fileNote)}" data-flag-title="${esc(F.fileNoteTitle)}"><p class="small muted">${X.intro(t.many)}</p><p><strong id="test-progress">${esc(X.progress.replace('{done}', '0').replace('{total}', String(total)))}</strong></p>${body}</section>`
}
