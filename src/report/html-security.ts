import type { Output } from '../output/schema.js'
import { HTML_TEXT as T } from './strings.js'

/** What the security section needs from the page renderer (implemented by the Html class of html.ts). */
export interface SectionRenderer {
  loc(path: string, line: number): string
  table<R>(cols: readonly string[], rows: readonly R[], render: (row: R) => string, numeric?: readonly number[]): string
}

function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function status(signal: { status: string; message?: string }): string | undefined {
  if (signal.status === 'ok') return undefined
  return `<p><span class="tag no">${signal.status === 'error' ? T.reportError : T.notVerified}</span> <span class="muted small">${esc(signal.message ?? '')}</span></p>`
}

const VULN_CHIP: Record<string, string> = { critical: 'high', high: 'high', moderate: 'medium', low: 'low', info: 'low' }

/** Static analysis findings on added lines, then vulnerabilities in added or changed dependencies. */
export function securitySection(o: Output, h: SectionRenderer): string {
  const s = o.signals.security
  const sast =
    status(s) ??
    h.table(T.sastCols, s.findings, (f) => `<tr><td>${h.loc(f.path, f.line)}</td><td><span class="chip ${f.severity}">${f.severity}</span></td><td><code>${esc(f.rule)}</code></td><td class="small">${esc(f.message)}</td><td><code class="small">${esc(f.text)}</code></td></tr>`)
  const v = o.signals.vulnerabilities
  const vulns =
    status(v) ??
    `${h.table(T.vulnCols, v.related, (r) => {
      const advisory = `${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.id)}</a>` : esc(r.id)}${r.cves.length > 0 ? ` <span class="muted small">${esc(r.cves.join(', '))}</span>` : ''}<div class="small">${esc(r.title)}</div>`
      return `<tr><td><code>${esc(r.package)}</code></td><td><span class="chip ${VULN_CHIP[r.severity] ?? 'low'}">${r.severity}</span></td><td>${advisory}</td><td><code class="small">${esc(r.vulnerableRange ?? '')}</code></td><td><code class="small">${esc(r.patchedVersions ?? '')}</code></td><td class="small">${esc(r.relatedTo.join(', '))}</td><td><span class="tag">${T.vulnKinds[r.kind]}</span></td></tr>`
    })}${v.total ? `<p class="small muted">${esc(T.vulnTotal(v.total))}</p>` : ''}`
  return `<section class="panel"><h3>${T.sastTitle}</h3><p class="small muted">${T.sastIntro}</p>${sast}<h3>${T.vulnTitle}</h3><p class="small muted">${T.vulnIntro}</p>${vulns}</section>`
}
