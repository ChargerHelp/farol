import { UsageError } from '../config/load.js'
import { GitHubClient } from '../github/client.js'
import { upsertComment } from '../github/comment.js'
import type { Output } from '../output/schema.js'
import { renderReport } from '../report/markdown.js'
import { linkerFor, readOutputFile, withReviewers } from './report.js'

export interface CommentOptions {
  in: string
  pr: number | string
  repo?: string
  reportUrl?: string
  reviewers?: string
  /** Create a new comment instead of updating the project's farol comment (one comment per push). */
  new?: boolean
  /** Incremental analyze JSON (analyze --since) shown on top, with its report link. */
  sinceIn?: string
  sinceReportUrl?: string
}

export async function commentCommand(options: CommentOptions, env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): Promise<number> {
  const pr = Number(options.pr)
  if (!Number.isInteger(pr) || pr <= 0) throw new UsageError(`--pr must be a pull request number, got "${options.pr}"`)
  const repo = options.repo ?? env.GITHUB_REPOSITORY
  if (!repo?.includes('/')) throw new UsageError('repository unknown: pass --repo owner/name or set GITHUB_REPOSITORY')
  const token = env.GITHUB_TOKEN
  if (!token) throw new UsageError('GITHUB_TOKEN is not set; pass it to the step with env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  const output = withReviewers(readOutputFile(options.in), options.reviewers)
  if (options.reportUrl !== undefined && !options.reportUrl.startsWith('https://')) throw new UsageError(`--report-url must be an https URL, got "${options.reportUrl}"`)
  if (options.sinceReportUrl !== undefined && !options.sinceReportUrl.startsWith('https://')) throw new UsageError(`--since-report-url must be an https URL, got "${options.sinceReportUrl}"`)
  const since = options.sinceIn === undefined ? undefined : { output: sinceOutput(options.sinceIn, output.project), ...(options.sinceReportUrl === undefined ? {} : { reportUrl: options.sinceReportUrl }) }
  const body = renderReport(output, undefined, linkerFor(output, { repo, pr }, env), options.reportUrl, since)
  const client = new GitHubClient({ token, repo, ...(env.GITHUB_API_URL ? { apiUrl: env.GITHUB_API_URL } : {}), ...(fetchImpl ? { fetch: fetchImpl } : {}) })
  const result = options.new === true ? { action: 'created' as const, url: (await client.createComment(pr, body)).html_url } : await upsertComment(client, pr, body, output.project)
  process.stderr.write(`farol: comment ${result.action}: ${result.url}\n`)
  return 0
}

const projectName = (project: string | null): string => (project === null ? 'the root project' : `project ${project}`)

/** The incremental result shown on top of the comment: it must come from the same project. */
function sinceOutput(path: string, project: string | null): Output {
  const since = readOutputFile(path)
  if (since.project !== project) throw new UsageError(`--since-in ${path} is a result of ${projectName(since.project)}, not of ${projectName(project)}: pass the incremental result of the same project`)
  return since
}
