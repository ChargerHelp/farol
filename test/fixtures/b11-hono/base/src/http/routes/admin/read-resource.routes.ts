import { Hono } from 'hono'
import type { ReadRecords } from '../../../use-cases/read-records'

export function createReadResourceRoutes(records: ReadRecords, opts: { resourceName: string }): Hono {
  const routes = new Hono()

  routes.get('/', async (c) => {
    return c.json(await records.list(Number(c.req.query('page') ?? 1)))
  })

  routes.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.text(`${opts.resourceName} id must be an integer`, 400)
    return c.json(await records.get(id))
  })

  return routes
}
