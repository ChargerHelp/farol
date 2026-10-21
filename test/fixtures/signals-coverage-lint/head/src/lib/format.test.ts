import { expect, it } from 'vitest'
import { formatPercent } from './format'

it('formats percentages', () => {
  expect(formatPercent(0.5)).toBe('50%')
})
