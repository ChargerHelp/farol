import { describe, expect, it } from 'vitest'
import { isDeclarationsOnlyModule } from '../../src/classify/declarations-only.js'

describe('isDeclarationsOnlyModule', () => {
  it('accepts types, re-exports, enums and constants with static values', () => {
    expect(isDeclarationsOnlyModule('a.types.ts', 'import type { X } from "./x"\nexport interface A { x: X }\nexport type B = A | null')).toBe(true)
    expect(isDeclarationsOnlyModule('index.ts', 'export * from "./a"\nexport { b as c } from "./b"')).toBe(true)
    expect(isDeclarationsOnlyModule('a.consts.ts', 'import { BASE } from "./base"\nexport enum Kind { A, B }\nexport const LIMITS = { max: 10, min: -1, url: `${BASE}/x`, list: ["a", BASE.y] } as const\nexport default LIMITS')).toBe(true)
  })

  it('accepts static values passed through a named function, and arrow functions that only return a static value', () => {
    expect(isDeclarationsOnlyModule('a.i18n.ts', "import { defineKeys } from '@/i18n'\nexport const I18N = defineKeys({ title: { key: 'A-title', defaultValue: 'Title' }, count: (p: { n: number }) => ({ key: 'A-count', parameters: p }) })")).toBe(true)
  })

  it('rejects logic, calls, functions, JSX, side-effect imports, let and parse errors', () => {
    expect(isDeclarationsOnlyModule('a.ts', 'export const x = compute(load())')).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', 'export const store = createStore()')).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', 'export const f = () => { return 1 }')).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', 'export const f = (a: number) => a + 1')).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', "import { useState } from 'react'\nexport const useX = () => { const [s] = useState(0); return s }")).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', 'export function f() {}')).toBe(false)
    expect(isDeclarationsOnlyModule('a.tsx', 'export const el = <div />')).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', 'import "./polyfill"')).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', 'export let x = 1')).toBe(false)
    expect(isDeclarationsOnlyModule('a.ts', 'export const x = {')).toBe(false)
    expect(isDeclarationsOnlyModule('a.py', 'X = 1')).toBe(false)
  })
})
