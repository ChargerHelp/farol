import { Hono } from 'hono'
import { type AdminUseCases, createAdminRoutes } from './admin.routes'

export function createHttpApp(useCases: AdminUseCases): Hono {
  const app = new Hono()
  app.route('/admin/api', createAdminRoutes(useCases))
  return app
}
