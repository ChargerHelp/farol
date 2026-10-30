import { describe, expect, it } from 'vitest'
import { underPath } from '../../src/backend/hono-paths.js'

describe('the path a Hono registration covers', () => {
  it.each([
    ['/x', '/x/*', true],
    ['/x/a', '/x/*', true],
    ['/x/a/b', '/x/*', true],
    ['/y', '/x/*', false],
    ['/xy', '/x/*', false],
    ['/anything', '/*', true],
    ['/', '/*', true],
    ['/x/:id', '/x/*', true],
    ['/:section', '/x/*', true],
    ['/admin/*', '/admin/api/*', true],
    ['/x/a', '/x', true],
  ])('%s under %s: %s', (path, full, expected) => {
    expect(underPath(path, full)).toBe(expected)
  })
})
