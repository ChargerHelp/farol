import {
  buildASTSchema,
  concatAST,
  findBreakingChanges,
  findDangerousChanges,
  getNamedType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isUnionType,
  type DocumentNode,
  type GraphQLNamedType,
  type GraphQLSchema,
} from 'graphql'
import { compareStrings } from '../output/order.js'
import type { ContractLevel } from './types.js'

export interface EntryContractChange {
  /** Entry point key (`Query.getBrand`). */
  key: string
  level: ContractLevel
  where: string
  detail: string
}

const BUILT_IN = new Set(['String', 'Int', 'Float', 'Boolean', 'ID'])

function build(docs: readonly DocumentNode[]): GraphQLSchema {
  // Federation and framework directives are often used without definitions: the SDL is taken as valid.
  return buildASTSchema(concatAST([...docs]), { assumeValid: true, assumeValidSDL: true })
}

/** Types each root field returns (through fields, unions and implementations) and takes (through input objects). */
function reachOf(schema: GraphQLSchema): Map<string, { out: Set<string>; in: Set<string> }> {
  const out = new Map<string, { out: Set<string>; in: Set<string> }>()
  const walkOut = (start: GraphQLNamedType, seen: Set<string>): void => {
    const stack = [start]
    while (stack.length > 0) {
      const t = stack.pop() as GraphQLNamedType
      if (seen.has(t.name)) continue
      seen.add(t.name)
      if (isObjectType(t) || isInterfaceType(t)) for (const f of Object.values(t.getFields())) stack.push(getNamedType(f.type))
      if (isUnionType(t) || isInterfaceType(t)) for (const p of schema.getPossibleTypes(t)) stack.push(p)
    }
  }
  const walkIn = (start: GraphQLNamedType, seen: Set<string>): void => {
    const stack = [start]
    while (stack.length > 0) {
      const t = stack.pop() as GraphQLNamedType
      if (seen.has(t.name)) continue
      seen.add(t.name)
      if (isInputObjectType(t)) for (const f of Object.values(t.getFields())) stack.push(getNamedType(f.type))
    }
  }
  for (const root of [schema.getQueryType(), schema.getMutationType(), schema.getSubscriptionType()]) {
    if (!root) continue
    for (const field of Object.values(root.getFields())) {
      const reach = { out: new Set<string>(), in: new Set<string>() }
      walkOut(getNamedType(field.type), reach.out)
      for (const arg of field.args) walkIn(getNamedType(arg.type), reach.in)
      out.set(`${root.name}.${field.name}`, reach)
    }
  }
  return out
}

/** Type (and field) a graphql-js change description is about: `Brand.name changed…`, `…on input type BrandInput…`. */
export function subjectOf(description: string): { type: string; field?: string } | null {
  const member = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/.exec(description) ?? /\bon ([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/.exec(description) ?? /\bon (?:input |object |interface )?type ([A-Za-z_]\w*)\b/.exec(description)
  if (member?.[2] !== undefined) return { type: member[1] ?? '', field: member[2] }
  if (member) return { type: member[1] ?? '' }
  const kinds = /\b(?:from|to) (?:enum|union|object|interface|input) type ([A-Za-z_]\w*)\b/.exec(description)
  if (kinds) return { type: kinds[1] ?? '' }
  const leading = /^([A-Za-z_]\w*) (?:was removed|changed from|added to|is no longer|was added)/.exec(description)
  return leading ? { type: leading[1] ?? '' } : null
}

/**
 * Breaking and dangerous changes between the base and head GraphQL schemas (graphql-js rules), each attributed to the
 * root operations it concerns: the root field itself, or every operation that returns or takes the changed type.
 * Safe changes (new types, fields, optional arguments) are not listed. Throws when a schema cannot be built.
 */
export function graphqlContractChanges(baseDocs: readonly DocumentNode[], headDocs: readonly DocumentNode[]): EntryContractChange[] {
  if (baseDocs.length === 0 || headDocs.length === 0) return []
  const base = build(baseDocs)
  const head = build(headDocs)
  const reach = new Map([...reachOf(base), ...reachOf(head)])
  const roots = new Set([base, head].flatMap((s) => [s.getQueryType(), s.getMutationType(), s.getSubscriptionType()]).filter((t) => t !== null && t !== undefined).map((t) => t.name))
  const out: EntryContractChange[] = []
  const report = (level: ContractLevel, description: string): void => {
    const subject = subjectOf(description)
    const where = subject === null ? 'schema' : subject.field === undefined ? subject.type : `${subject.type}.${subject.field}`
    let keys: string[]
    if (subject === null || BUILT_IN.has(subject.type)) keys = [...reach.keys()]
    else if (roots.has(subject.type)) keys = subject.field === undefined ? [...reach.keys()].filter((k) => k.startsWith(`${subject.type}.`)) : [`${subject.type}.${subject.field}`]
    else keys = [...reach].filter(([, r]) => r.out.has(subject.type) || r.in.has(subject.type)).map(([k]) => k)
    for (const key of keys) out.push({ key, level, where, detail: description })
  }
  for (const c of findBreakingChanges(base, head)) report('breaking', c.description)
  for (const c of findDangerousChanges(base, head)) report('dangerous', c.description)
  return out.sort((a, b) => compareStrings(a.key, b.key) || compareStrings(a.level, b.level) || compareStrings(a.where, b.where))
}
