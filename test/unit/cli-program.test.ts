import { describe, expect, it } from 'vitest'
import { buildProgram } from '../../src/cli/program.js'

describe('cli program', () => {
  it('registers every command from the spec', () => {
    const names = buildProgram().commands.map((c) => c.name())
    expect(names).toEqual(['analyze', 'report', 'html', 'comment', 'routes', 'impact', 'calibrate', 'history', 'reviewers', 'usage'])
  })
})
