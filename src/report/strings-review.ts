/** User-facing text of the review plan and the manual test checklist (re-exported by strings.ts). */
/** The review plan at the top of the HTML report. */
export const PLAN_TEXT = {
  title: 'Review plan',
  levels: { pass: '✓ Fast track', quick: '◐ Quick review', careful: '⚠ Careful review' } as const,
  advice: {
    pass: 'Nothing existing is widely affected: skim the diff and approve.',
    quick: 'Existing code changed in a contained way: check the files below, then approve.',
    careful: 'This can break things widely or silently: read the files below closely and test what they reach before approving.',
  } as const,
  classTitle: 'Classification (see Details)',
  codeFiles: (code: number, other: number) => `${code} code file${code === 1 ? '' : 's'}${other > 0 ? ` + ${other} other` : ''}`,
  affected: (affected: number, added: number, many: string) => `${affected} existing ${many} affected${added > 0 ? `, ${added} new` : ''}`,
  coverageFact: (percent: number | null) => (percent === null ? 'diff coverage not verified' : `${percent}% diff coverage`),
  securityFact: (n: number) => (n === 0 ? 'no security finding' : `${n} security finding${n === 1 ? '' : 's'}`),
  dependencyFact: (n: number) => (n === 0 ? 'no critical dependency change' : `${n} critical dependency change${n === 1 ? '' : 's'}`),
  lintFact: (n: number) => (n === 0 ? 'no lint error' : `${n} lint error${n === 1 ? '' : 's'}`),
  startTitle: 'Start here',
  startHint: '— riskiest first; tick a file once reviewed',
  nothingToStart: 'No changed code file carries notable risk.',
  infraTitle: (n: number) => `Environment, infrastructure and CI (${n})`,
  infraHint: '— not run by any page or operation, but by deployments: check the values for each environment',
  skimTitle: (n: number) => `Then skim: ${n} low-risk code file${n === 1 ? '' : 's'}`,
  otherTitle: (n: number) => `Probably no review needed: ${n} file${n === 1 ? '' : 's'} (not code, dependencies, tests)`,
  otherIntro: 'Docs, assets, lockfiles and tests. Dependency changes are judged in Dependencies, tests in Coverage.',
  otherKinds: { 'not-code': 'Not code', dependency: 'Manifests and lockfiles', test: 'Tests' } as const,
  markReviewed: 'Mark as reviewed',
  entryFilter: (one: string) => `Filter by ${one}: type part of a path, e.g. /brands`,
  entryFilterClear: 'Clear',
  entryFilterCount: '{n} file(s) reach it',
  exitFullscreen: '✕ Exit full screen',
  fullscreen: '⤢ Full screen',
  fullscreenTitle: 'Open in full screen (Esc to leave)',
  showDiff: (added: number, removed: number) => `Show diff (+${added} −${removed})`,
  untestedLine: 'added line no test runs',
  diffTruncated: 'Diff cut here (size limit).',
  diffOnGithub: 'Full diff on GitHub',
  incremental: (since: string) => `Incremental: only the changes since ${since} (your last review). Links open the comparison of the new commits.`,
  reviewersTitle: 'Suggested reviewers',
  codeowner: (n: number) => `code owner of ${n} file${n === 1 ? '' : 's'}`,
  author: (files: number, commits: number) => `changed ${files} of these file${files === 1 ? '' : 's'} recently (${commits} commit${commits === 1 ? '' : 's'})`,
  noReviewers: 'no CODEOWNERS entry and no recent author outside this PR',
  pointsTitle: 'Risk of this file on its own (0–100): reach × what its diff coverage leaves, plus its findings',
  reach: (n: number, total: number, many: string) => `${n}/${total} ${many}`,
  covered: (percent: number) => `${percent}% covered`,
  coverageNone: 'declarations only',
  coverageUnverified: 'coverage not verified',
  security: (n: number) => `${n} security`,
  lint: (n: number) => `${n} lint error${n === 1 ? '' : 's'}`,
  suppressions: (n: number) => `${n} suppression${n === 1 ? '' : 's'}`,
}

/** The manual test checklist (HTML section and PR comment). */
export const TEST_TEXT = {
  intro: (many: string) => `Try these ${many} by hand before approving: new ones first, then the affected ones whose changed file carries the most risk. Ticks are kept in this browser for this commit.`,
  none: (many: string) => `No ${many} to test: the PR neither adds nor affects any.`,
  newTag: 'new',
  affectedTag: 'affected',
  because: (file: string) => `via ${file}`,
  renders: (file: string) => `renders ${file}`,
  count: (n: number) => `${n} to test`,
  progress: '{done} of {total} tested',
  reviewedProgress: ' · {n} with every changed file reviewed',
  filesReviewed: '✓ files reviewed',
  filesReviewedTitle: 'Every changed file behind it is marked as reviewed (testing it by hand is still up to you)',
  commentTitle: (n: number) => `Manual test checklist (${n})`,
  commentMore: (n: number) => `and ${n} more in the HTML report`,
}

/** Traffic from a usage report (Datadog RUM page views, APM requests): information only. */
export const USAGE_TEXT = {
  label: 'Traffic',
  unit: (kind: 'pages' | 'operations') => (kind === 'pages' ? 'views' : 'requests'),
  fact: (share: number | null, kind: 'pages' | 'operations') => (share === null ? 'no traffic data' : `${share}% of ${kind === 'pages' ? 'page views' : 'requests'}`),
  factTitle: (source: string, days: number) => `Share of the traffic attributed to pages/operations that goes to the affected ones (${source}, last ${days} days; health checks left out). Information only: it does not change the score.`,
  summary: (share: number | null, hits: string, total: string, kind: 'pages' | 'operations', source: string, days: number) =>
    share === null
      ? `no traffic recorded for the affected ${kind} (${source}, last ${days} days)`
      : `the affected ${kind} get ${share}% of ${kind === 'pages' ? 'page views' : 'requests'} (${hits} of ${total} attributed to ${kind}; ${source}, last ${days} days)`,
  hits: (hits: string, kind: 'pages' | 'operations') => `${hits} ${kind === 'pages' ? 'views' : 'requests'}`,
  distinct: (issues: number) => `${issues} distinct error${issues === 1 ? '' : 's'}`,
  openInDatadog: 'Open these errors in Datadog',
  item: (hits: string, kind: 'pages' | 'operations', issues = 0) => `${hits} ${kind === 'pages' ? 'views' : 'requests'}${issues > 0 ? `, ${issues} distinct error${issues === 1 ? '' : 's'}` : ''}`,
  issuesOn: (n: number) => `; ${n} distinct error${n === 1 ? '' : 's'} on them (Error Tracking issues)`,
  filesLabel: 'Errors in changed files',
  filesSummary: (n: number, source: string, days: number) => `${n} changed file${n === 1 ? '' : 's'} threw errors (Error Tracking, ${source}, last ${days} days)`,
  fileItem: (errors: string, issues: number, types: string) => `${errors} error${errors === '1' ? '' : 's'} in ${issues} issue${issues === 1 ? '' : 's'}${types ? ` (${types})` : ''}`,
  filePill: (errors: string) => `${errors} errors thrown here`,
  filePillTitle: (issues: number, types: string, days: number) => `Error Tracking: ${issues} issue${issues === 1 ? '' : 's'} thrown in this file in the last ${days} days${types ? `: ${types}` : ''}`,
  filesFact: (n: number) => `${n} changed file${n === 1 ? '' : 's'} with errors`,
  pill: (hits: string, kind: 'pages' | 'operations') => `${hits} ${kind === 'pages' ? 'views' : 'requests'}`,
  pillTitle: (days: number) => `Traffic of the affected pages or operations this file reaches, last ${days} days`,
  error: (message: string) => `usage report not read: ${message}`,
}


/** Reviewers by authorship (`farol reviewers`). */
export const OWNER_TEXT = {
  title: 'Suggested reviewers',
  intro: 'Who wrote the code this PR changes (git blame at the base, weighed by each file\'s risk). PR authors and bots are left out.',
  score: (n: number) => `wrote ${n}% of the changed code`,
  scoreTitle: 'Share of the PR\'s risk, weighed by file, whose code this person wrote (half the whole file, half the changed lines and their context)',
  inactive: 'inactive',
  inactiveTitle: 'No commit in the last 6 months: may have moved on',
  file: (path: string, share: number) => `${path} ${share}%`,
  codeowners: 'Code owners',
  none: 'no author left besides the PR\'s own',
  owner: (name: string, share: number) => `✍ ${name} ${share}%`,
  ownerTitle: 'Main author of this file at the base (git blame); new files: of its directory',
  comment: (name: string, score: number, files: string, inactive: boolean) => `${name} (${score}%${files ? `: ${files}` : ''}${inactive ? ', inactive' : ''})`,
}




/** The "since the last push" block of a PR comment (comment --since-in). */
export const SINCE_TEXT = {
  title: (from: string, to: string) => `🔁 **Since the last push** (\`${from}..${to}\`)`,
  summary: (verdict: string, score: number, level: string, files: number) => `${verdict} · merge risk score ${score}/100 (${level}) · ${files} changed file${files === 1 ? '' : 's'}`,
  report: (url: string) => `[Report of these commits (HTML)](${url})`,
}
