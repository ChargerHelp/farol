import { createHttpApp } from './http/server'
import { registerRoutes } from './http/routes'
import { ListPrompts } from './use-cases/list-prompts'
import { ReadRecords } from './use-cases/read-records'

const app = createHttpApp()
registerRoutes(app, {
  prompts: new ListPrompts(),
  issues: new ReadRecords('issues'),
  signals: new ReadRecords('signals'),
  tasks: new ReadRecords('tasks'),
})
