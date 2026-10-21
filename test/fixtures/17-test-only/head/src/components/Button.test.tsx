import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('is a component', () => {
    expect(typeof Button).toBe('function')
  })
})
