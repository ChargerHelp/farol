import type { Output } from '../output/schema.js'
import { HIGH_SCORE, MEDIUM_SCORE, mergeScore, scoreGroups, scoreLevel, type ScoreGroup } from './merge-score.js'

export { scoreGroups } from './merge-score.js'
import { HTML_TEXT as T } from './strings.js'

/** What the score card needs from the page renderer (implemented by the Html class of html.ts). */
export interface ScoreRenderer {
  path(p: string): string
}

/** Contributors shown before "and N more"; the script shows the next ones as files get reviewed. */
const SHOWN_DRIVERS = 6

function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** Merge risk score of every file that adds to it (for the "reviewed" panel). */
export function scoreByFile(o: Output): Map<string, number> {
  return new Map(scoreGroups(mergeScore(o).items).flatMap((g) => (g.file === null ? [] : [[g.file, g.points] as const])))
}

function driver(g: ScoreGroup, h: ScoreRenderer, hidden: boolean): string {
  const [top] = g.items
  const what = g.file === null ? esc(top?.title ?? '') : `${h.path(g.file)} <span class="muted small">${esc(top?.title ?? '')}${g.items.length > 1 ? esc(T.scoreMoreItems(g.items.length - 1)) : ''}</span>`
  const weights = g.items.map((i) => i.weight).join(',')
  return `<li data-file="${esc(g.file ?? '')}" data-weights="${weights}"${hidden ? ' hidden' : ''}><span class="score-points">${g.points}</span> ${what}</li>`
}

/**
 * The merge risk score (0–100, higher is riskier), compact, for the review plan; every contributor is listed in a
 * collapsed block. Ticking files as reviewed removes their items and the score is recomputed in the page.
 */
export function scoreBox(o: Output, h: ScoreRenderer): string {
  const { score, level, items } = mergeScore(o)
  const groups = scoreGroups(items)
  const drivers = groups.length === 0 ? `<p class="muted small">${T.scoreNone}</p>` : `<ol class="score-drivers" id="score-drivers">${groups.map((g, i) => driver(g, h, i >= SHOWN_DRIVERS)).join('')}</ol>`
  const more = groups.length > SHOWN_DRIVERS ? groups.length - SHOWN_DRIVERS : 0
  return `<div class="score-box" id="merge-score" data-high="${HIGH_SCORE}" data-medium="${MEDIUM_SCORE}" data-shown="${SHOWN_DRIVERS}">
<div class="muted small">${T.scoreTitle}</div>
<div class="score-value ${level}"><span id="score-value">${score}</span><span class="score-max">/100</span></div>
<div><span class="chip ${level}" id="score-level">${T.severity[scoreLevel(score)]}</span><span class="small muted" id="score-reviewed"></span></div>
<div class="small" id="score-progress" data-template="${esc(T.scoreProgress)}" hidden></div>
<div class="bar score-bar ${level === 'high' ? 'bad' : level === 'medium' ? 'warn' : ''}" id="score-bar"><span style="width:${score}%"></span></div>
<details class="small score-details"><summary>${T.scoreDrivers(groups.length)}</summary><p class="muted">${T.scoreIntro}</p>${drivers}<p class="small muted" id="score-more"${more === 0 ? ' hidden' : ''} data-template="${esc(T.scoreMore)}">${esc(T.scoreMore.replace('{n}', String(more)))}</p></details>
</div>`
}
