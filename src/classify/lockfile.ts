import { posix } from 'node:path'
import type { ChangedFile } from '../git/types.js'
import { sortedUnique } from '../output/order.js'
import type { ManifestResult } from './dependencies.js'
import { reason, type Reason } from './reasons.js'

function manifestsWithDependencyChanges(manifests: readonly ManifestResult[]): string[] {
  return sortedUnique(manifests.filter((m) => !('error' in m) && m.changes.length > 0).map((m) => m.manifest))
}

function unreadable(manifests: readonly ManifestResult[]): string {
  const paths = sortedUnique(manifests.filter((m) => 'error' in m).map((m) => m.manifest))
  return paths.length === 0 ? '' : `; could not read ${paths.join(', ')}`
}

/** A lockfile covers the manifests in its directory and below: only those can explain its changes. */
function covers(lockfile: string, manifest: string): boolean {
  const dir = posix.dirname(lockfile)
  return dir === '.' || manifest.startsWith(`${dir}/`)
}

/**
 * Why a lockfile changed. With dependency changes in the project's manifests, it follows them. With dependency
 * changes only in manifests of other projects the lockfile covers (a shared monorepo lockfile), resolved versions this
 * project loads may still differ (hoisting, deduplication), so it touches existing code. Without any, or when one of
 * the project's own manifests cannot be read, the change is global.
 */
export function lockfileReason(file: ChangedFile, manifests: readonly ManifestResult[], otherManifests: readonly ManifestResult[]): Reason {
  if (manifestsWithDependencyChanges(manifests).length > 0) return reason('lockfile-changed', `lockfile ${file.status} together with dependency changes`, file.path)
  const coveredOthers = otherManifests.filter((m) => covers(file.path, m.manifest))
  const explaining = manifestsWithDependencyChanges(coveredOthers)
  if (explaining.length > 0 && !manifests.some((m) => 'error' in m)) return reason('lockfile-changed-elsewhere', `lockfile ${file.status} by dependency changes in ${explaining.join(', ')}: resolved versions this project loads may differ${unreadable(coveredOthers)}`, file.path)
  return reason('lockfile-only-change', `lockfile ${file.status} without any dependency change in the manifests: resolved versions may differ${unreadable([...manifests, ...coveredOthers])}`, file.path)
}
