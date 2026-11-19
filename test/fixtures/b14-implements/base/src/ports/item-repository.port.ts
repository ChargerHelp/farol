export interface IItemRepository {
  find(): Promise<string[]>
}
