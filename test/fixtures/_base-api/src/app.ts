import Fastify from 'fastify'
import { handleStripe } from './rest/stripe'

export function buildApp() {
  const app = Fastify()
  app.get('/health', async () => ({ ok: true }))
  app.post('/webhooks/stripe', handleStripe)
  return app
}
