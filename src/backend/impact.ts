import { compareStrings, sortedUnique } from '../output/order.js'
import type { ResolverChanges } from './resolvers.js'
import { restAnchor } from './rest.js'
import type { SchemaDiff } from './schema.js'

/** What a changed schema or resolver file does to the operations. */
export interface BackendFileImpact {
  /** Nothing that existed changed: only new fields, types, resolvers or endpoints. */
  additive: boolean
  problems: string[]
  /** Existing operations affected, with the schema member or resolver that affects them. */
  affected: Map<string, string>
  /** New root operations or endpoints. */
  addedOperations: string[]
  /** New fields, types or resolvers that are not operations (informational). */
  added: string[]
  /** File chain from each affected operation to the change, when known (else the file itself). */
  chains?: Map<string, string[]>
  /** TypeScript: type declarations that changed (erased at runtime, so not problems). */
  erased?: string[]
  /** Added files only (Go): new entry points that reach the file's code; present when the impact covers new files. */
  newEntriesReaching?: string[]
}

export interface ImpactTable {
  resolverKeys: ReadonlyMap<string, ReadonlySet<string>>
  operationTypes: ReadonlyMap<string, ReadonlySet<string>>
  rootTypes: ReadonlySet<string>
}

function typeOf(member: string): string {
  const cut = [member.indexOf('.'), member.indexOf('|'), member.indexOf('&')].filter((i) => i >= 0)
  return cut.length === 0 ? member : member.slice(0, Math.min(...cut))
}

/** Operations that run a schema member: the root field itself, or every operation that can return its type. */
function operationsUsingMember(member: string, table: ImpactTable): string[] {
  const type = typeOf(member)
  return [...table.operationTypes.entries()].filter(([op, types]) => op === member || types.has(type)).map(([op]) => op)
}

function operationsUsingResolver(key: string, table: ImpactTable): string[] {
  return [...table.resolverKeys.entries()].filter(([, keys]) => keys.has(key)).map(([op]) => op).sort(compareStrings)
}

/**
 * Impact of one changed file from its SDL diff and its resolver/endpoint diff (either may be absent). Endpoint keys of
 * the diff are paths as written in `file`; they run the endpoints of their handler anchor (one per Hono mount).
 */
export function backendFileImpact(table: ImpactTable, file: string, schema: SchemaDiff | undefined, resolvers: (ResolverChanges & { keys: string[] }) | undefined): BackendFileImpact {
  const using = (k: string): string[] => operationsUsingResolver(k.includes(' ') ? restAnchor(file, k) : k, table)
  /** The full endpoint keys of a handler when its mounts change them, else the key as written. */
  const label = (k: string): string => {
    const ops = k.includes(' ') ? using(k) : []
    return ops.length === 0 || (ops.length === 1 && ops[0] === k) ? k : ops.join(', ')
  }
  const affected = new Map<string, string>()
  const problems: string[] = []
  const addedOperations: string[] = []
  const added: string[] = []
  const hit = (ops: string[], cause: string): void => {
    for (const op of ops) if (!affected.has(op)) affected.set(op, cause)
  }
  if (schema) {
    for (const m of schema.removed) {
      problems.push(`schema member ${m} was removed`)
      hit(operationsUsingMember(m, table), m)
    }
    for (const m of schema.changed) {
      problems.push(`schema member ${m} changed (type, arguments or directives)`)
      hit(operationsUsingMember(m, table), m)
    }
    for (const m of schema.added) (table.rootTypes.has(typeOf(m)) && m.includes('.') ? addedOperations : added).push(m)
  }
  if (resolvers) {
    for (const k of resolvers.removed) {
      problems.push(`${k.includes(' ') ? 'endpoint' : 'resolver'} ${label(k)} was removed`)
      hit(using(k), k)
    }
    for (const k of resolvers.changed) {
      problems.push(`${k.includes(' ') ? 'endpoint' : 'resolver'} ${label(k)} changed`)
      hit(using(k), k)
    }
    // The endpoints under a removed mount are gone from the head: they cannot be named, the change still counts.
    for (const prefix of resolvers.removedMounts) problems.push(`mount ${prefix} was removed`)
    if (resolvers.restChanged) {
      problems.push('code outside the resolvers changed (imports, helpers or module-level code): every resolver of the file may behave differently')
      for (const k of resolvers.keys) hit(using(k), `module code of ${k}`)
    }
    for (const k of resolvers.added) {
      if (k.includes(' ')) addedOperations.push(...label(k).split(', '))
      else added.push(k)
    }
  }
  return {
    additive: problems.length === 0,
    problems,
    affected: new Map([...affected.entries()].sort(([a], [b]) => compareStrings(a, b))),
    addedOperations: sortedUnique(addedOperations),
    added: sortedUnique(added),
  }
}
