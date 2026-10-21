import { FEEDBACK_OPTIONS, MARKER } from '../report/strings.js'
import type { GitHubClient, IssueComment } from './client.js'

/** Marker of comments written before the project was renamed (revscope → farol): they are updated, not duplicated. */
export const LEGACY_MARKER = '<!-- revscope -->'

/** The farol comment of a PR: the first comment that starts with the hidden marker (or the legacy one). */
export function findFarolComment(comments: readonly IssueComment[]): IssueComment | undefined {
  return comments.find((c) => typeof c.body === 'string' && (c.body.trimStart().startsWith(MARKER) || c.body.trimStart().startsWith(LEGACY_MARKER)))
}

function checkedLabels(body: string): Set<string> {
  const checked = new Set<string>()
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('- [x] ') && !line.startsWith('- [X] ')) continue
    const label = line.slice(6).trim()
    if ((FEEDBACK_OPTIONS as readonly string[]).includes(label)) checked.add(label)
  }
  return checked
}

/** Copies the feedback checkboxes ticked in the old comment into the new body. */
export function preserveFeedback(oldBody: string, newBody: string): string {
  const checked = checkedLabels(oldBody)
  if (checked.size === 0) return newBody
  return newBody
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('- [ ] ')) return line
      const label = trimmed.slice(6).trim()
      return checked.has(label) ? line.replace('- [ ] ', '- [x] ') : line
    })
    .join('\n')
}

export type CommentResult = { action: 'created' | 'updated' | 'unchanged'; url: string }

/** Creates the farol comment or updates the existing one, keeping the reviewers' feedback marks. */
export async function upsertComment(client: GitHubClient, pr: number, body: string): Promise<CommentResult> {
  const existing = findFarolComment(await client.listComments(pr))
  if (!existing) {
    const created = await client.createComment(pr, body)
    return { action: 'created', url: created.html_url }
  }
  const merged = preserveFeedback(existing.body, body)
  if (merged === existing.body) return { action: 'unchanged', url: existing.html_url }
  const updated = await client.updateComment(existing.id, merged)
  return { action: 'updated', url: updated.html_url }
}
