import { Hono } from 'hono'
import type { GetPrompt } from '../use-cases/get-prompt'
import type { ListPrompts } from '../use-cases/list-prompts'

export interface PromptUseCases {
  list: ListPrompts
  get: GetPrompt
}

export function createPromptRoutes(useCases: PromptUseCases): Hono {
  const routes = new Hono()

  routes.get('/', async (c) => c.json(await useCases.list.execute()))
  routes.get('/:id', async (c) => c.json(await useCases.get.execute(c.req.param('id'))))

  return routes
}
