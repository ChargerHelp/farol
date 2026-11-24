import type { IIssueReadRepository } from '../ports/issue-read-repository.port'

export class GetIssue {
  constructor(private readonly repo: IIssueReadRepository) {}

  async execute(id: number): Promise<string> {
    return this.repo.get(id)
  }
}
