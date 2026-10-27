import { describe, expect, it } from 'vitest'
import { findSuppressions } from '../../src/signals/suppressions.js'

const all = (code: string): Set<number> => new Set(code.split('\n').map((_, i) => i + 1))

describe('findSuppressions', () => {
  it('finds directives in comments and any in code', () => {
    const code = [
      '// eslint-disable-next-line no-console',
      'console.log(1) // eslint-disable-line',
      '/* eslint-disable */',
      '// @ts-expect-error wrong type',
      '/** @ts-ignore */',
      '// @ts-nocheck',
      'const a = value as any',
      'function f(x: any): any { return x }',
      'const ok: Array<any> = []',
    ].join('\n')
    expect(findSuppressions('a.ts', code, all(code)).map((i) => [i.line, i.kind])).toEqual([
      [1, 'eslint-disable-next-line'],
      [2, 'eslint-disable-line'],
      [3, 'eslint-disable'],
      [4, 'ts-expect-error'],
      [5, 'ts-ignore'],
      [6, 'ts-nocheck'],
      [7, 'as-any'],
      [8, 'any-annotation'],
      [8, 'any-annotation'],
    ])
  })

  it('finds Biome suppression comments, except the range end and formatter or assist ignores', () => {
    const code = [
      '// biome-ignore-all lint: generated',
      '// biome-ignore lint/suspicious/noDoubleEquals: legacy',
      '// biome-ignore-start lint/style: reason',
      '// biome-ignore-end lint/style: reason',
      '// biome-ignore lint/suspicious/noDebugger',
      '// biome-ignore format: aligned',
      '// biome-ignore assist/source/organizeImports: order',
      '// biome-ignored lint: x',
      '// biome-ignore syntax: legacy parser',
      '// biome-ignore-all format: generated',
      '// biome-ignore-start assist/source/organizeImports: order',
      '// biome-ignore',
    ].join('\n')
    expect(findSuppressions('a.ts', code, all(code)).map((i) => [i.line, i.kind])).toEqual([
      [1, 'biome-ignore-all'],
      [2, 'biome-ignore'],
      [3, 'biome-ignore-start'],
      [5, 'biome-ignore'],
      [9, 'biome-ignore'],
      [12, 'biome-ignore'],
    ])
  })

  it('ignores the same sequences inside strings, templates and JSX text', () => {
    const code = [
      "const s = '// eslint-disable-next-line'",
      'const t = `/* @ts-ignore */ ${"as any"} as any`',
      'const r = "x as any"',
      'export const C = () => <p>// eslint-disable-line @ts-ignore as any</p>',
    ].join('\n')
    expect(findSuppressions('a.tsx', code, all(code))).toEqual([])
  })

  it('only reports added lines and finds comments inside JSX expressions', () => {
    const code = ['// @ts-ignore', 'export const C = () => (', '  <div>', '    {/* eslint-disable-next-line */}', '  </div>', ')'].join('\n')
    expect(findSuppressions('a.tsx', code, new Set([4])).map((i) => [i.line, i.kind, i.text])).toEqual([[4, 'eslint-disable-next-line', '{/* eslint-disable-next-line */}']])
  })
})
