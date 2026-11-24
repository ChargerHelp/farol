import type { IIssueReadRepository } from '../ports/issue-read-repository.port'

export class PgIssueReadRepository implements IIssueReadRepository {
  async list(page: number): Promise<string[]> {
    return [`issue page ${page}`]
  }

  async get(id: number): Promise<string> {
    return `issue ${id}`
  }
}
