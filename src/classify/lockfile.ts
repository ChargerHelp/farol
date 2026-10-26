import type { ChangedFile } from '../git/types.js'
import { sortedUnique } from '../output/order.js'
import type { ManifestDiff } from './dependencies.js'
import { reason, type Reason } from './reasons.js'

type ManifestResult = ManifestDiff | { manifest: string; error: string }

function withDependencyChanges(manifests: readonly ManifestResult[]): string[] {
  return sortedUnique(manifests.filter((m) => !('error' in m) && m.changes.length > 0).map((m) => m.manifest))
}

/**
 * Why a lockfile changed. With dependency changes in the project's manifests, it follows them. With dependency
 * changes only in manifests of other projects (a shared monorepo lockfile), resolved versions this project loads may
 * still differ (hoisting, deduplication), so it touches existing code. Without any, the change is global.
 */
export function lockfileReason(file: ChangedFile, manifests: readonly ManifestResult[], otherManifests: readonly ManifestResult[]): Reason {
  if (withDependencyChanges(manifests).length > 0) return reason('lockfile-changed', `lockfile ${file.status} together with dependency changes`, file.path)
  const others = withDependencyChanges(otherManifests)
  if (others.length > 0) return reason('lockfile-changed-elsewhere', `lockfile ${file.status} by dependency changes in ${others.join(', ')}: resolved versions this project loads may differ`, file.path)
  return reason('lockfile-only-change', `lockfile ${file.status} without any dependency change in the manifests: resolved versions may differ`, file.path)
}
