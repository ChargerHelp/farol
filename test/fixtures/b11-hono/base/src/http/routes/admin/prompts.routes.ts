import { Hono } from 'hono'
import type { ListPrompts } from '../../../use-cases/list-prompts'
import { bodyLimitGuard } from './body-limit'

export function createPromptRoutes(prompts: ListPrompts): Hono {
  const routes = new Hono()

  routes.get('/', async (c) => {
    const keys = await prompts.execute()
    return c.json(keys)
  })

  routes.get('/:key', async (c) => {
    return c.json({ key: c.req.param('key') })
  })

  routes.post('/', bodyLimitGuard(1024), async (c) => {
    return c.json(await c.req.json(), 201)
  })

  return routes
}
