import type { ListItems } from '../use-cases/list-items'

export function registerItems(app: { get(path: string, handler: () => unknown): void }, listItems: ListItems) {
  app.get('/items', async () => listItems.execute())
}
