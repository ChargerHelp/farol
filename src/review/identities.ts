import { compareStrings } from '../output/order.js'

/** Name tokens, lowercased letters and digits only: `Jane Mary Doe` → jane, mary, doe. */
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== '')
}

/** GitHub login of a noreply address (`123+login@users.noreply.github.com`), lowercased. */
function loginOf(email: string): string | null {
  const at = email.toLowerCase().indexOf('@users.noreply.github.com')
  if (at < 0) return null
  const local = email.slice(0, at).toLowerCase()
  return local.includes('+') ? local.slice(local.indexOf('+') + 1) : local
}

function sameName(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  if (a.join('') === b.join('')) return true
  const [small, big] = a.length <= b.length ? [a, b] : [b, a]
  return small.length >= 2 && small.every((t) => big.includes(t))
}

/**
 * Groups git identities (`name<TAB>email`) that are one person: the same email, a GitHub noreply login equal to a
 * name, or names where one holds every word of the other (two words at least) or that differ only by spaces
 * (`johnsmith` / `John Smith`). Each identity maps to the group's display name: the most common name with a
 * space, else the most common one. A .mailmap in the repository is applied before this (by git).
 */
export function canonicalNames(identities: Iterable<string>, weight: (identity: string) => number = () => 1): Map<string, string> {
  const ids = [...new Set(identities)].sort(compareStrings)
  const parent = ids.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] ?? i)))
  const unite = (i: number, j: number): void => {
    parent[find(i)] = find(j)
  }
  const parsed = ids.map((id) => {
    const [name = '', email = ''] = id.split('\t')
    const login = loginOf(email)
    return { name, email: email.toLowerCase(), words: tokens(name), login: login === null ? null : tokens(login) }
  })
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = parsed[i]
      const b = parsed[j]
      if (!a || !b) continue
      const email = a.email !== '' && a.email === b.email
      const login = (a.login !== null && sameName(a.login, b.words)) || (b.login !== null && sameName(b.login, a.words))
      if (email || login || sameName(a.words, b.words)) unite(i, j)
    }
  }
  const groups = new Map<number, number[]>()
  ids.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]))
  const out = new Map<string, string>()
  for (const members of groups.values()) {
    const byName = new Map<string, number>()
    for (const i of members) {
      const p = parsed[i]
      if (p) byName.set(p.name, (byName.get(p.name) ?? 0) + weight(ids[i] ?? ''))
    }
    const names = [...byName].sort((x, y) => Number(y[0].includes(' ')) - Number(x[0].includes(' ')) || y[1] - x[1] || compareStrings(x[0], y[0]))
    const display = names[0]?.[0] ?? ''
    for (const i of members) out.set(ids[i] ?? '', display)
  }
  return out
}
