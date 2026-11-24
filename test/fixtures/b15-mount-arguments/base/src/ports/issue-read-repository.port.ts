export interface IIssueReadRepository {
  list(page: number): Promise<string[]>
  get(id: number): Promise<string>
}
