import { Hono } from 'hono'

export function createHttpApp(): Hono {
  const app = new Hono()
  app.use('*', async (_c, next) => {
    await next()
  })
  return app
}
