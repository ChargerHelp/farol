import type { Output } from '../output/schema.js'
import { PLAN_TEXT as P } from './strings.js'

function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

const LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  go: 'go', py: 'python', json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown', sh: 'bash', bash: 'bash', sql: 'sql', css: 'css', scss: 'scss',
  less: 'less', html: 'xml', xml: 'xml', svg: 'xml', toml: 'ini', ini: 'ini', graphql: 'graphql', gql: 'graphql', rs: 'rust', java: 'java', kt: 'kotlin', rb: 'ruby', php: 'php',
}

/** highlight.js language of a file, from its extension (Dockerfiles and env files by name); undefined: plain text. */
export function languageOf(path: string): string | undefined {
  const name = path.split('/').pop() ?? ''
  // highlight.js's common build has no Dockerfile grammar: shell is the closest.
  if (/^Dockerfile/.test(name) || name.endsWith('.dockerfile')) return 'bash'
  if (name === 'Makefile') return 'makefile'
  if (name.startsWith('.env') || name.endsWith('.env')) return 'bash'
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  return LANGUAGES[ext]
}

/** Head lines of a file that tests do not run, and lines with security or lint findings (message per line). */
function marks(o: Output, path: string): { uncovered: Set<number>; findings: Map<number, string[]> } {
  const uncovered = new Set<number>()
  for (const f of o.signals.coverage.files) if (f.path === path) for (const r of f.uncovered) for (let l = r.start; l <= r.end; l++) uncovered.add(l)
  const findings = new Map<number, string[]>()
  const add = (line: number, text: string): void => {
    findings.set(line, [...(findings.get(line) ?? []), text])
  }
  for (const s of o.signals.security.findings) if (s.path === path) add(s.line, `${s.severity} ${s.rule}: ${s.message}`)
  for (const l of o.signals.lint.findings) if (l.path === path) add(l.line, `${l.severity} ${l.rule}: ${l.message}`)
  for (const s of o.signals.suppressions.items) if (s.path === path) add(s.line, `suppression: ${s.kind}`)
  return { uncovered, findings }
}

/**
 * The file's diff inline (collapsed): added lines tests do not run are marked, lines with findings carry a ⚠ with
 * the messages. Large diffs are cut; the link opens the full diff on GitHub.
 */
export function diffBlock(o: Output, path: string, url: string | null): string {
  const diff = o.diffs?.find((d) => d.path === path)
  if (!diff || diff.hunks.length === 0) return ''
  const { uncovered, findings } = marks(o, path)
  let added = 0
  let removed = 0
  const rows: string[] = []
  for (const hunk of diff.hunks) {
    rows.push(`<tr class="hunk"><td colspan="3">${esc(hunk.header)}</td></tr>`)
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const line of hunk.lines) {
      const kind = line[0]
      const text = esc(line.slice(1))
      if (kind === '+') {
        added++
        const notes = findings.get(newLine)
        const untested = uncovered.has(newLine)
        const flag = notes ? `<span class="diff-flag" title="${esc(notes.join('\n'))}">⚠</span>` : untested ? `<span class="diff-flag untested" title="${esc(P.untestedLine)}">○</span>` : ''
        rows.push(`<tr class="add${untested ? ' untested' : ''}${notes ? ' flagged' : ''}"><td class="ln"></td><td class="ln">${newLine}</td><td class="code">${flag}<span class="mark">+</span><span class="src">${text}</span></td></tr>`)
        newLine++
      } else if (kind === '-') {
        removed++
        rows.push(`<tr class="del"><td class="ln">${oldLine}</td><td class="ln"></td><td class="code"><span class="mark">-</span><span class="src">${text}</span></td></tr>`)
        oldLine++
      } else {
        rows.push(`<tr class="ctx"><td class="ln">${oldLine}</td><td class="ln">${newLine}</td><td class="code"><span class="mark"> </span><span class="src">${text}</span></td></tr>`)
        oldLine++
        newLine++
      }
    }
  }
  const more = diff.truncated ? `<p class="small muted">${P.diffTruncated}${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">${P.diffOnGithub}</a>` : ''}</p>` : ''
  const lang = languageOf(path)
  return `<details class="inline-diff"><summary>${P.showDiff(added, removed)}</summary><div class="fs-target diff-wrap"><button type="button" class="fullscreen" title="${esc(P.fullscreenTitle)}">${P.fullscreen}</button><div class="diff"><table${lang ? ` data-lang="${lang}"` : ''}>${rows.join('')}</table></div></div>${more}</details>`
}
