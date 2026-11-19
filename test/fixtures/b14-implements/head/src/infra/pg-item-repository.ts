import type { IItemRepository } from '../ports/item-repository.port'

export class PgItemRepository implements IItemRepository {
  async find(): Promise<string[]> {
    return ['a', 'b'].sort()
  }
}
