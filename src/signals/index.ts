import type { CoverageSignal, LintSignal, SecuritySignal, Signals, SuppressionsSignal, TestsModifiedSignal, VulnerabilitiesSignal } from '../output/schema.js'

export function coverageNotProvided(message?: string): CoverageSignal {
  return { status: 'not-provided', ...(message === undefined ? {} : { message }), files: [], total: null, ignoredFiles: [] }
}

export function lintNotProvided(message?: string): LintSignal {
  return { status: 'not-provided', ...(message === undefined ? {} : { message }), changedLines: null, otherLines: null, findings: [], omittedFindings: 0 }
}

export function vulnerabilitiesNotProvided(message?: string): VulnerabilitiesSignal {
  return { status: 'not-provided', ...(message === undefined ? {} : { message }), related: [], total: null }
}

/** Signals of a failed analysis: nothing was verified. */
export function signalsNotProvided(message: string): Signals {
  const suppressions: SuppressionsSignal = { status: 'not-provided', message, items: [] }
  const testsModified: TestsModifiedSignal = { status: 'not-provided', message, files: [] }
  const security: SecuritySignal = { status: 'not-provided', message, findings: [], summary: { high: 0, medium: 0, low: 0 } }
  return { coverage: coverageNotProvided(message), lint: lintNotProvided(message), suppressions, testsModified, security, vulnerabilities: vulnerabilitiesNotProvided(message) }
}
