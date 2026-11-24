import type { IIssueReadRepository } from '../ports/issue-read-repository.port'

export class ListIssues {
  constructor(private readonly repo: IIssueReadRepository) {}

  async execute(page: number): Promise<string[]> {
    return this.repo.list(Math.max(page, 1))
  }
}
