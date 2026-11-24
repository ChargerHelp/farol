import { createHttpApp } from './http/server'
import { PgIssueReadRepository } from './infra/pg-issue-read-repository'
import { GetIssue } from './use-cases/get-issue'
import { GetPrompt } from './use-cases/get-prompt'
import { GetSignal } from './use-cases/get-signal'
import { ListIssues } from './use-cases/list-issues'
import { ListPrompts } from './use-cases/list-prompts'
import { ListSignals } from './use-cases/list-signals'

const issues = new PgIssueReadRepository()

export const app = createHttpApp({
  issues: { list: new ListIssues(issues), get: new GetIssue(issues) },
  signals: { list: new ListSignals(), get: new GetSignal() },
  prompts: { list: new ListPrompts(), get: new GetPrompt() },
})
