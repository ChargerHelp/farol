import { Hono } from 'hono'

export interface ReadResourceUseCases<TList, TDetail> {
  list: { execute(page: number): Promise<TList[]> }
  get: { execute(id: number): Promise<TDetail> }
}

export function createReadResourceRoutes<TList, TDetail>(useCases: ReadResourceUseCases<TList, TDetail>, opts: { resourceName: string }): Hono {
  const routes = new Hono()

  routes.get('/', async (c) => {
    return c.json(await useCases.list.execute(Number(c.req.query('page') ?? 1)))
  })

  routes.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.text(`${opts.resourceName} id must be an integer`, 400)
    return c.json(await useCases.get.execute(id))
  })

  return routes
}
