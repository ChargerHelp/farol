import type { DeclHelperOutput } from '../decls/types.js'
import { compareStrings } from '../output/order.js'
import type { Output } from '../output/schema.js'
import { compareContracts } from './compare.js'
import type { EntryContractChange } from './graphql.js'
import type { ContractLevel } from './types.js'

/** Entry kinds that clients call over the wire: their removal or contract change can break a client. */
const CALLED = new Set(['http', 'ws', 'rpc'])

/** Contract changes of the Go/Python entry points: removed endpoints, and base against head contracts of the others. */
export function helperContractChanges(base: DeclHelperOutput, head: DeclHelperOutput): { changes: EntryContractChange[]; readable: number } {
  const headByKey = new Map(head.entries.map((e) => [e.key, e]))
  const changes: EntryContractChange[] = []
  for (const b of base.entries) {
    if (!CALLED.has(b.kind)) continue
    const h = headByKey.get(b.key)
    if (h === undefined) {
      changes.push({ key: b.key, level: 'breaking', where: 'endpoint', detail: 'endpoint removed (or its method or path changed)' })
      continue
    }
    if (b.contract !== undefined && h.contract !== undefined) for (const c of compareContracts(b.contract, h.contract)) changes.push({ key: b.key, ...c })
    else if (b.contract !== undefined) changes.push({ key: b.key, level: 'dangerous', where: 'contract', detail: 'contract no longer readable: check by hand' })
  }
  return { changes, readable: head.entries.filter((e) => e.contract !== undefined).length }
}

export type Contracts = NonNullable<Output['contracts']>

const ORDER: Record<ContractLevel, number> = { breaking: 0, dangerous: 1, safe: 2 }
const MAX_CHANGES = 30

/** The output section: one item per entry point with changes, worst first. */
export function contractsSection(changes: readonly EntryContractChange[], readable: number, problem?: string): Contracts {
  const byKey = new Map<string, EntryContractChange[]>()
  for (const c of changes) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c])
  const entries = [...byKey].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => ORDER[a.level] - ORDER[b.level] || compareStrings(a.where, b.where) || compareStrings(a.detail, b.detail))
    const level = sorted[0]?.level ?? 'safe'
    return { key, level, changes: sorted.slice(0, MAX_CHANGES).map(({ level: l, where, detail }) => ({ level: l, where, detail })), omitted: Math.max(0, sorted.length - MAX_CHANGES) }
  })
  entries.sort((a, b) => ORDER[a.level] - ORDER[b.level] || compareStrings(a.key, b.key))
  const count = (l: ContractLevel): number => entries.filter((e) => e.level === l).length
  return { readable, entries, summary: { breaking: count('breaking'), dangerous: count('dangerous'), safe: count('safe') }, ...(problem === undefined ? {} : { problem }) }
}
