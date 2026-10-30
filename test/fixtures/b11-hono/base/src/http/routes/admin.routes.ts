import { Hono } from 'hono'
import type { ListPrompts } from '../../use-cases/list-prompts'
import type { ReadRecords } from '../../use-cases/read-records'
import { createPromptRoutes } from './admin/prompts.routes'
import { createReadResourceRoutes } from './admin/read-resource.routes'

export interface AdminUseCases {
  prompts: ListPrompts
  issues: ReadRecords
  signals: ReadRecords
  tasks: ReadRecords
}

export function createAdminRoutes(useCases: AdminUseCases): Hono {
  const routes = new Hono()

  routes.get('/whoami', (c) => c.json({ name: 'operator' }))

  routes.route('/prompts', createPromptRoutes(useCases.prompts))
  routes.route('/issues', createReadResourceRoutes(useCases.issues, { resourceName: 'issue' }))
  routes.route('/signals', createReadResourceRoutes(useCases.signals, { resourceName: 'signal' }))
  routes.route('/tasks', createReadResourceRoutes(useCases.tasks, { resourceName: 'task' }))

  return routes
}
