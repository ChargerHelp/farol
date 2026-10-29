import type { Hono } from 'hono'
import { type AdminUseCases, createAdminRoutes } from './admin.routes'
import { createHealthRoutes } from './health.routes'

export function registerRoutes(app: Hono, useCases: AdminUseCases): void {
  app.route('/', createHealthRoutes())
  app.route('/admin/api', createAdminRoutes(useCases))
  app.get('/admin/*', async (c) => c.text('spa'))
}
