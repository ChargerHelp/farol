import { Hono } from 'hono'
import type { GetIssue } from '../use-cases/get-issue'
import type { GetSignal } from '../use-cases/get-signal'
import type { ListIssues } from '../use-cases/list-issues'
import type { ListSignals } from '../use-cases/list-signals'
import { createPromptRoutes, type PromptUseCases } from './prompts.routes'
import { createReadResourceRoutes } from './read-resource.routes'

export interface AdminUseCases {
  issues: { list: ListIssues; get: GetIssue }
  signals: { list: ListSignals; get: GetSignal }
  prompts: PromptUseCases
}

export function createAdminRoutes(useCases: AdminUseCases): Hono {
  const routes = new Hono()

  routes.get('/whoami', (c) => c.json({ name: 'operator' }))

  routes.route('/issues', createReadResourceRoutes(useCases.issues, { resourceName: 'issue' }))
  routes.route('/signals', createReadResourceRoutes(useCases.signals, { resourceName: 'signal' }))
  routes.route('/prompts', createPromptRoutes(useCases.prompts))

  return routes
}
