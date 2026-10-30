import { Kind, type DocumentNode } from 'graphql'
import { backendFileImpact, type BackendFileImpact } from '../backend/impact.js'
import type { BackendTable } from '../backend/entrypoints.js'
import { diffResolvers, resolverEntries } from '../backend/resolvers.js'
import { restAnchor } from '../backend/rest.js'
import { compareStrings, sortedUnique } from '../output/order.js'
import { diffSdl, parseSdl, sdlSources } from '../backend/schema.js'
import type { AnalysisRole } from '../classify/roles.js'
import { readFiles } from '../git/index.js'
import type { ChangedFile } from '../git/types.js'
import type { RouteTable } from '../routes/types.js'
import type { Context } from './context.js'
import { graphqlContractChanges, type EntryContractChange } from '../contracts/graphql.js'

/** All type system definitions of a file (a .graphql file or every gql`…` template of a TS/JS file), as one document. */
function fileSchema(file: string, code: string | undefined): DocumentNode | null {
  if (code === undefined) return null
  const docs = sdlSources(file, code).sources.map((s) => parseSdl(s).doc).filter((d) => d !== null)
  if (docs.length === 0) return null
  return { kind: Kind.DOCUMENT, definitions: docs.flatMap((d) => d.definitions) }
}

/**
 * Impact of every changed schema or resolver file: the SDL and the resolvers/endpoints of its base and head versions,
 * each parsed on its own, are compared member by member.
 */
export async function backendImpacts(
  ctx: Context,
  table: BackendTable,
  files: readonly ChangedFile[],
  roleOf: (path: string) => AnalysisRole | 'outside',
  baseSha: string,
  headSha: string,
): Promise<{ impacts: Map<string, BackendFileImpact>; baseRoutes: RouteTable; contracts: { changes: EntryContractChange[]; problem?: string } }> {
  const targets = files.filter((f) => f.status === 'modified' && (roleOf(f.path) === 'schema' || roleOf(f.path) === 'resolvers'))
  const paths = targets.map((f) => f.path)
  const base = await readFiles(ctx.repoRoot, baseSha, paths)
  const head = await readFiles(ctx.repoRoot, headSha, paths)
  const impacts = new Map<string, BackendFileImpact>()
  const addedOperations = new Set<string>()
  // Handlers and mounts the PR adds: the endpoints the head has without them existed before.
  const addedAnchors = new Set<string>()
  const addedMounts = new Map<string, { file: string; prefix: string }>()
  for (const f of targets) {
    const before = base.get(f.path)
    const after = head.get(f.path)
    const isCode = !f.path.endsWith('.graphql') && !f.path.endsWith('.gql')
    const schema = diffSdl(fileSchema(f.path, before), fileSchema(f.path, after))
    let resolvers: Parameters<typeof backendFileImpact>[3]
    let h: ReturnType<typeof resolverEntries> | undefined
    if (isCode && before !== undefined && after !== undefined) {
      const b = resolverEntries(f.path, before, table.typeFields, ctx.config.backend.rest)
      h = resolverEntries(f.path, after, table.typeFields, ctx.config.backend.rest)
      if (b.entries.length + h.entries.length + b.mounts.size + h.mounts.size > 0) resolvers = { ...diffResolvers(b, h), keys: [...new Set([...b.entries, ...h.entries].map((e) => e.key))] }
    }
    for (const k of resolvers?.added ?? []) if (k.includes(' ')) addedAnchors.add(restAnchor(f.path, k))
    for (const m of resolvers?.addedMounts ?? []) addedMounts.set(m, { file: f.path, prefix: h?.mounts.get(m)?.prefix ?? '' })
    const impact = backendFileImpact(table, f.path, schema.added.length + schema.removed.length + schema.changed.length > 0 ? schema : undefined, resolvers)
    impacts.set(f.path, impact)
    for (const op of impact.addedOperations) addedOperations.add(op)
  }
  // New root fields and endpoints are the backend's new routes: the base table is the head table without them.
  for (const f of files) {
    if (f.status === 'added' && (roleOf(f.path) === 'schema' || roleOf(f.path) === 'resolvers')) {
      const after = (await readFiles(ctx.repoRoot, headSha, [f.path])).get(f.path)
      const schema = diffSdl(null, fileSchema(f.path, after))
      for (const m of schema.added) if (table.rootTypes.has(m.slice(0, m.indexOf('.'))) && m.includes('.')) addedOperations.add(m)
      if (after !== undefined && !f.path.endsWith('.graphql')) {
        const added = resolverEntries(f.path, after, table.typeFields, ctx.config.backend.rest)
        for (const e of added.entries) if (e.key.includes(' ')) addedAnchors.add(restAnchor(f.path, e.key))
        for (const [m, { prefix }] of added.mounts) addedMounts.set(m, { file: f.path, prefix })
      }
    }
  }
  const baseRest = table.restKeysWithout(new Set(addedMounts.keys()), addedAnchors)
  const baseRoutes = table.operations.filter((r) => (r.key.includes(' ') ? baseRest.has(r.key) : !addedOperations.has(r.key)))
  // A new mount serves its sub-app's routes and middleware under its paths: existing endpoints there are touched.
  for (const [id, { file, prefix }] of addedMounts) {
    const covered = sortedUnique(table.mountBases(id).flatMap((b) => [...baseRest].filter((k) => under(k.slice(k.indexOf(' ') + 1), b))))
    if (covered.length === 0) continue
    const prev = impacts.get(file) ?? { additive: false, problems: [], affected: new Map<string, string>(), addedOperations: [], added: [] }
    const affected = new Map([...prev.affected, ...covered.filter((k) => !prev.affected.has(k)).map((k) => [k, `mount ${prefix}`] as const)].sort(([a], [b]) => compareStrings(a, b)))
    impacts.set(file, { ...prev, additive: false, problems: [...prev.problems, `mount ${prefix} covers existing endpoints: its middleware and routes run for them`], affected })
  }
  return { impacts, baseRoutes: { routes: baseRoutes, dynamic: [], sources: [] }, contracts: await schemaContracts(ctx, table, files, baseSha) }
}

/** Whether a URL path is served under a mount's full path. */
function under(path: string, base: string): boolean {
  return base === '/' || path === base || path.startsWith(base.endsWith('/') ? base : `${base}/`)
}

/**
 * Contract changes of the GraphQL schema: the head schema against the base one, which is the head schema with every
 * changed SDL file in its base version (added files left out, deleted ones put back).
 */
async function schemaContracts(ctx: Context, table: BackendTable, files: readonly ChangedFile[], baseSha: string): Promise<{ changes: EntryContractChange[]; problem?: string }> {
  if (table.schemaDocs.length === 0) return { changes: [] }
  const sdlFile = (p: string): boolean => /\.(graphql|gql|ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(p)
  const touched = files.filter((f) => table.schemaFiles.has(f.path) || (f.status !== 'added' && sdlFile(f.oldPath ?? f.path)))
  if (touched.length === 0) return { changes: [] }
  const changed = new Set(touched.flatMap((f) => [f.path, f.oldPath ?? f.path]))
  const base = await readFiles(ctx.repoRoot, baseSha, touched.filter((f) => f.status !== 'added').map((f) => f.oldPath ?? f.path))
  const baseDocs = [...table.schemaDocs.filter((d) => !changed.has(d.file)).map((d) => d.doc), ...[...base].map(([file, code]) => fileSchema(file, code)).filter((d) => d !== null)]
  try {
    return { changes: graphqlContractChanges(baseDocs, table.schemaDocs.map((d) => d.doc)) }
  } catch (error) {
    // A schema graphql-js cannot build (types defined elsewhere, interpolated SDL): no comparison, said so.
    return { changes: [], problem: `GraphQL contracts not compared: ${error instanceof Error ? error.message : String(error)}` }
  }
}
