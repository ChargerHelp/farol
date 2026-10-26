import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutputSchema, type Output } from '../../src/output/schema.js'
import { moduleOf, testPlan } from '../../src/report/test-plan.js'
import { FIXTURES_DIR } from '../helpers/repo.js'

function golden(scenario: string): Output {
  return OutputSchema.parse(JSON.parse(readFileSync(join(FIXTURES_DIR, scenario, 'expected.json'), 'utf8')))
}

describe('manual test checklist', () => {
  it('lists new entry points first, then affected ones, grouped by module', () => {
    const plan = testPlan(golden('g1-new-endpoint'))
    expect(plan.flatMap((g) => g.items.map((i) => [i.kind, i.key]))).toEqual([['new', 'GET /brands/count']])
    const affected = testPlan(golden('g3-store-changed')).flatMap((g) => g.items.map((i) => [g.label, i.key, i.because]))
    expect(affected).toEqual(
      expect.arrayContaining([
        ['GET /brands', 'GET /brands', 'internal/store/store.go'],
        ['RUN', 'RUN cmd/worker', 'internal/store/store.go'],
      ]),
    )
  })

  it('carries the changed files behind each item, for the review state of the HTML report', () => {
    const items = testPlan(golden('05-shared-component')).flatMap((g) => g.items)
    expect(items.map((i) => [i.path, i.files])).toEqual([
      ['/', ['src/components/Card.tsx']],
      ['/products', ['src/components/Card.tsx']],
    ])
  })

  it('groups pages by their first URL segment and services by service and method', () => {
    const front = golden('05-shared-component')
    expect(moduleOf(front, '/products/:id')).toBe('/products')
    expect(moduleOf({ ...front, surface: 'backend' }, 'orders_api GET /orders')).toBe('orders_api GET')
    expect(moduleOf({ ...front, surface: 'backend' }, 'Query.brand')).toBe('Query')
  })
})
