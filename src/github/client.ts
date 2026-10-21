/** Minimal GitHub REST client over native fetch: only what the PR comment needs. */

export interface IssueComment {
  id: number
  body: string
  html_url: string
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export interface GitHubClientOptions {
  token: string
  /** owner/name */
  repo: string
  apiUrl?: string
  fetch?: typeof fetch
}

const HINTS: Record<number, string> = {
  401: 'the token is invalid or expired (check GITHUB_TOKEN)',
  403: 'the token lacks permission (the job needs "permissions: pull-requests: write"; pull requests from forks only get a read-only token)',
  404: 'the repository or pull request was not found, or the token cannot see it (check --repo and --pr)',
  422: 'GitHub rejected the request content',
}

/** URL of the next page from a Link header (`<url>; rel="next"`), parsed without regular expressions. */
export function nextPageUrl(link: string | null): string | undefined {
  if (!link) return undefined
  for (const part of link.split(',')) {
    const [urlPart, ...params] = part.split(';').map((p) => p.trim())
    if (params.some((p) => p === 'rel="next"') && urlPart?.startsWith('<') && urlPart.endsWith('>')) return urlPart.slice(1, -1)
  }
  return undefined
}

export class GitHubClient {
  private readonly apiUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: GitHubClientOptions) {
    this.apiUrl = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '')
    this.fetchImpl = options.fetch ?? fetch
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.options.token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'farol',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      throw new GitHubError(`GitHub API ${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`, 0)
    }
    if (!response.ok) {
      let detail = ''
      try {
        const data = (await response.json()) as { message?: unknown }
        if (typeof data.message === 'string') detail = ` (${data.message})`
      } catch {
        // The error body is optional: the status alone is enough to explain the failure.
      }
      const hint = HINTS[response.status]
      throw new GitHubError(`GitHub API ${method} ${url} failed: ${response.status} ${response.statusText}${detail}${hint ? `; ${hint}` : ''}`, response.status)
    }
    return response
  }

  /** Every comment of an issue or pull request, following pagination. */
  async listComments(pr: number): Promise<IssueComment[]> {
    const comments: IssueComment[] = []
    let url: string | undefined = `${this.apiUrl}/repos/${this.options.repo}/issues/${pr}/comments?per_page=100`
    while (url !== undefined) {
      const response = await this.request('GET', url)
      const page = (await response.json()) as IssueComment[]
      comments.push(...page)
      url = nextPageUrl(response.headers.get('link'))
    }
    return comments
  }

  async createComment(pr: number, body: string): Promise<IssueComment> {
    const response = await this.request('POST', `${this.apiUrl}/repos/${this.options.repo}/issues/${pr}/comments`, { body })
    return (await response.json()) as IssueComment
  }

  async updateComment(id: number, body: string): Promise<IssueComment> {
    const response = await this.request('PATCH', `${this.apiUrl}/repos/${this.options.repo}/issues/comments/${id}`, { body })
    return (await response.json()) as IssueComment
  }
}
