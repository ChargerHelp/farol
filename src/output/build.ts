import type { ClassifyResult } from '../classify/classify.js'
import { reason } from '../classify/reasons.js'
import { signalsNotProvided } from '../signals/index.js'
import type { Output, Signals } from './schema.js'
import { TOOL_NAME, TOOL_VERSION } from './tool.js'

export interface OutputMeta {
  repo: string | null
  pr: number | null
  surface: 'frontend' | 'backend'
  base: { ref: string; sha: string | null }
  mergeBase: string | null
  head: { ref: string; sha: string | null }
  analyzedAt: Date
  timingsMs: Record<string, number>
  ignoredFiles: string[]
  incremental?: { since: string }
  reviewers?: Output['reviewers']
  diffs?: Output['diffs']
  usage?: Output['usage']
  contracts?: Output['contracts']
}

function header(meta: OutputMeta): Pick<Output, 'schemaVersion' | 'surface' | 'tool' | 'repo' | 'pr' | 'base' | 'mergeBase' | 'head' | 'analyzedAt'> {
  return {
    schemaVersion: 1,
    surface: meta.surface,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    repo: meta.repo,
    pr: meta.pr,
    base: meta.base,
    mergeBase: meta.mergeBase,
    head: meta.head,
    analyzedAt: meta.analyzedAt.toISOString(),
  }
}

export function buildOutput(meta: OutputMeta, result: ClassifyResult, signals: Signals): Output {
  return {
    ...header(meta),
    classification: result.classification,
    reasons: result.reasons,
    files: result.files,
    ignoredFiles: meta.ignoredFiles,
    dependencies: result.dependencies,
    risk: result.risk,
    routes: result.routes,
    signals,
    diagnostics: { ...result.diagnostics, timingsMs: meta.timingsMs, error: null },
    review: null,
    ...(meta.incremental ? { incremental: meta.incremental } : {}),
    ...(meta.reviewers ? { reviewers: meta.reviewers } : {}),
    ...(meta.diffs ? { diffs: meta.diffs } : {}),
    ...(meta.usage ? { usage: meta.usage } : {}),
    ...(meta.contracts ? { contracts: meta.contracts } : {}),
  }
}

/** Output of an analysis that failed: `unknown`, with the error in diagnostics. */
export function failureOutput(meta: OutputMeta, error: string): Output {
  return {
    ...header(meta),
    classification: 'unknown',
    reasons: [reason('analysis-error', error)],
    files: [],
    ignoredFiles: meta.ignoredFiles,
    dependencies: { manifests: [], lockfiles: [], changes: [], summary: { critical: 0, major: 0, minor: 0, patch: 0, added: 0, removed: 0 } },
    risk: { totalPages: 0, files: [], summary: { high: 0, medium: 0, low: 0 } },
    routes: { added: [], affected: [], disconnectedNewFiles: [] },
    signals: signalsNotProvided('the analysis failed before signals were computed'),
    diagnostics: { unresolvedImports: [], dynamicRoutes: [], parseErrors: [], timingsMs: meta.timingsMs, error },
    review: null,
    ...(meta.incremental ? { incremental: meta.incremental } : {}),
  }
}
