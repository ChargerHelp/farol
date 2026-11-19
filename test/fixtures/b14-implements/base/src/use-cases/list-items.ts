import type { IItemRepository } from '../ports/item-repository.port'

export interface ListItemsDeps {
  repo: IItemRepository
}

export class ListItems {
  private readonly repo: IItemRepository

  constructor(deps: ListItemsDeps) {
    this.repo = deps.repo
  }

  async execute(): Promise<string[]> {
    return this.repo.find()
  }
}
