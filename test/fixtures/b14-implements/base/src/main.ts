import { buildApp } from './app'
import { PgItemRepository } from './infra/pg-item-repository'
import { registerItems } from './rest/items'
import { ListItems } from './use-cases/list-items'

const app = buildApp()
registerItems(app, new ListItems({ repo: new PgItemRepository() }))
