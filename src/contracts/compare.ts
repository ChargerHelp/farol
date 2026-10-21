import type { Contract, ContractChange, ContractLevel, Field, Shape } from './types.js'

/** Who reads the value: `in` is sent by the client (request), `out` is read by the client (response). */
type Direction = 'in' | 'out'

function describe(s: Shape): string {
  switch (s.k) {
    case 'scalar':
    case 'ref':
    case 'unknown':
      return s.n
    case 'enum':
      return s.n === '' ? `enum(${s.v.join('|')})` : s.n
    case 'list':
      return `${describe(s.of)}[]`
    case 'object':
      return s.n === '' ? 'object' : s.n
    case 'union':
      return s.of.map(describe).join(' | ')
  }
}

/** Name used to pair union members and to recognize a type cut by recursion (`ref`). */
function nameOf(s: Shape): string {
  return s.k === 'list' ? `${nameOf(s.of)}[]` : s.k === 'object' || s.k === 'ref' || s.k === 'enum' || s.k === 'scalar' || s.k === 'unknown' ? `${s.k === 'ref' ? 'object' : s.k}:${s.n}` : describe(s)
}

class Collector {
  readonly changes: ContractChange[] = []
  add(level: ContractLevel, where: string, detail: string): void {
    this.changes.push({ level, where, detail })
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function compareShape(base: Shape, head: Shape, dir: Direction, where: string, c: Collector): void {
  if (same(base, head)) return
  // A type already described higher up is cut to a reference: the same name on both sides compares equal here.
  if ((base.k === 'ref' || head.k === 'ref') && nameOf(base) === nameOf(head)) return
  if (base.k === 'unknown' || head.k === 'unknown') {
    c.add('dangerous', where, `cannot compare ${describe(base)} with ${describe(head)}: check by hand`)
    return
  }
  if (base.k !== head.k) {
    c.add('breaking', where, `type changed from ${describe(base)} to ${describe(head)}`)
    return
  }
  if (base.k === 'scalar' && head.k === 'scalar') c.add('breaking', where, `type changed from ${base.n} to ${head.n}`)
  else if (base.k === 'enum' && head.k === 'enum') {
    const removed = base.v.filter((v) => !head.v.includes(v))
    const added = head.v.filter((v) => !base.v.includes(v))
    // Clients send values (a removed one is rejected) and read values (a new one may be unhandled).
    if (removed.length > 0) c.add(dir === 'in' ? 'breaking' : 'safe', where, `enum values removed: ${removed.join(', ')}`)
    if (added.length > 0) c.add(dir === 'in' ? 'safe' : 'dangerous', where, `enum values added: ${added.join(', ')}`)
  } else if (base.k === 'list' && head.k === 'list') compareShape(base.of, head.of, dir, `${where}[]`, c)
  else if (base.k === 'object' && head.k === 'object') compareObject(base.f, head.f, dir, where, c)
  else if (base.k === 'union' && head.k === 'union') {
    const b = new Map(base.of.map((s) => [nameOf(s), s]))
    const h = new Map(head.of.map((s) => [nameOf(s), s]))
    for (const [name, s] of b) {
      const now = h.get(name)
      if (now === undefined) c.add(dir === 'in' ? 'breaking' : 'safe', where, `${dir === 'in' ? 'no longer accepts' : 'no longer returns'} ${describe(s)}`)
      else compareShape(s, now, dir, where, c)
    }
    for (const [name, s] of h) if (!b.has(name)) c.add(dir === 'in' ? 'safe' : 'dangerous', where, `${dir === 'in' ? 'also accepts' : 'may also return'} ${describe(s)}`)
  }
}

function compareObject(base: Record<string, Field>, head: Record<string, Field>, dir: Direction, where: string, c: Collector): void {
  for (const [name, field] of Object.entries(base).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const now = head[name]
    const at = where === '' ? name : `${where}.${name}`
    if (now === undefined) {
      // A client reading a removed field breaks; one still sending it is ignored or rejected, depending on the model.
      c.add(dir === 'out' ? 'breaking' : 'dangerous', at, dir === 'out' ? 'field removed' : 'field removed: clients still sending it may be rejected')
    } else compareField(field, now, dir, at, c)
  }
  for (const [name, field] of Object.entries(head).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (name in base) continue
    const at = where === '' ? name : `${where}.${name}`
    if (dir === 'out') c.add('safe', at, 'field added')
    else c.add(field.req ? 'breaking' : 'safe', at, field.req ? 'new required field' : 'new optional field')
  }
}

function compareField(base: Field, head: Field, dir: Direction, where: string, c: Collector): void {
  if (dir === 'in') {
    if (!base.req && head.req) c.add('breaking', where, 'became required')
    if (base.req && !head.req) c.add('safe', where, 'became optional')
    if (base.null && !head.null) c.add('breaking', where, 'no longer accepts null')
    if (!base.null && head.null) c.add('safe', where, 'now accepts null')
  } else {
    if (base.req && !head.req) c.add('breaking', where, 'may be missing now')
    if (!base.null && head.null) c.add('breaking', where, 'may be null now')
    if (!base.req && head.req) c.add('safe', where, 'always present now')
    if (base.null && !head.null) c.add('safe', where, 'never null now')
  }
  compareShape(base.s, head.s, dir, where, c)
}

const LEVEL_ORDER: Record<ContractLevel, number> = { breaking: 0, dangerous: 1, safe: 2 }

/**
 * Changes between the base and head contracts of one endpoint, most severe first. A side the helper could not read
 * (null) is never treated as unchanged: losing it is `dangerous`.
 */
export function compareContracts(base: Contract, head: Contract): ContractChange[] {
  const c = new Collector()
  for (const [name, field] of Object.entries(base.params)) {
    const now = head.params[name]
    if (now === undefined) c.add('dangerous', name, 'parameter removed: clients still sending it may be rejected')
    else compareField(field, now, 'in', name, c)
  }
  for (const [name, field] of Object.entries(head.params)) if (!(name in base.params)) c.add(field.req ? 'breaking' : 'safe', name, field.req ? 'new required parameter' : 'new optional parameter')
  if (base.body !== null && head.body !== null) compareField(base.body, head.body, 'in', 'body', c)
  else if (base.body === null && head.body !== null) c.add(head.body.req ? 'breaking' : 'safe', 'body', head.body.req ? 'now requires a body' : 'now accepts a body')
  else if (base.body !== null && head.body === null) c.add('dangerous', 'body', 'request body no longer read (or no longer readable)')
  if (base.response !== null && head.response !== null) compareShape(base.response, head.response, 'out', 'response', c)
  else if (base.response !== null && head.response === null) c.add('dangerous', 'response', 'response no longer readable: check by hand')
  return c.changes.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || (a.where < b.where ? -1 : a.where > b.where ? 1 : 0))
}
