import picomatch from 'picomatch'
import { compareStrings } from '../output/order.js'

/** A suggested reviewer: a CODEOWNERS owner of changed files, or a recent author of them. */
export interface Reviewer {
  name: string
  kind: 'codeowner' | 'history'
  files: string[]
  commits: number
}

interface Rule {
  match: (path: string) => boolean
  owners: string[]
}

/**
 * CODEOWNERS rules (GitHub syntax, gitignore-like patterns): `/x` is anchored, `x/` is a directory, a pattern without
 * a slash matches at any depth. Later rules win.
 */
export function parseCodeowners(text: string): Rule[] {
  const rules: Rule[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (line === '') continue
    const [pattern = '', ...owners] = line.split(/\s+/)
    let glob = pattern.replace(/^\//, '')
    const anchored = pattern.startsWith('/') || glob.replace(/\/$/, '').includes('/')
    if (glob.endsWith('/')) glob = `${glob}**`
    const globs = [anchored ? glob : `**/${glob}`]
    // A plain name may be a directory: it owns everything below it.
    if (!glob.includes('*')) globs.push(`${globs[0] ?? ''}/**`)
    const match = picomatch(globs, { dot: true })
    rules.push({ match: (path) => match(path), owners })
  }
  return rules
}

export function ownersOf(rules: readonly Rule[], path: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]
    if (rule?.match(path)) return rule.owners
  }
  return []
}

/**
 * Reviewers for the changed files: code owners (by files owned), then the people who changed those files most
 * recently (by files touched, then commits), without the PR's own authors and bots.
 */
export function rankReviewers(files: readonly string[], rules: readonly Rule[], history: ReadonlyMap<string, readonly string[]>, prAuthors: ReadonlySet<string>, max = 5): Reviewer[] {
  const owners = new Map<string, string[]>()
  for (const f of files) for (const o of ownersOf(rules, f)) owners.set(o, [...(owners.get(o) ?? []), f])
  const people = new Map<string, { files: Set<string>; commits: number }>()
  for (const [file, authors] of history) {
    for (const a of authors) {
      if (prAuthors.has(a) || /\[bot\]$|^dependabot|^renovate/i.test(a)) continue
      const p = people.get(a) ?? { files: new Set<string>(), commits: 0 }
      p.files.add(file)
      p.commits++
      people.set(a, p)
    }
  }
  const codeowners = [...owners.entries()].map(([name, list]): Reviewer => ({ name, kind: 'codeowner', files: [...new Set(list)].sort(compareStrings), commits: 0 }))
  const authors = [...people.entries()].map(([name, p]): Reviewer => ({ name, kind: 'history', files: [...p.files].sort(compareStrings), commits: p.commits }))
  const order = (a: Reviewer, b: Reviewer): number => b.files.length - a.files.length || b.commits - a.commits || compareStrings(a.name, b.name)
  return [...codeowners.sort(order).slice(0, max), ...authors.sort(order).slice(0, max)]
}
