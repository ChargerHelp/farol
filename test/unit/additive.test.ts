import { describe, expect, it } from 'vitest'
import { checkBarrelAdditive, checkI18nAdditive, compareRouteTables, JsonParseError, unexplainedRemovedLines } from '../../src/classify/additive.js'
import type { RouteEntry } from '../../src/routes/types.js'

const route = (key: string, entry: string | null, layouts: string[] = []): RouteEntry => ({ key, path: `/${key}`, index: false, entry, modules: entry ? [entry] : [], layouts })

describe('routes rule', () => {
  const base = { routes: [route('a', 'src/A.tsx'), route('b', 'src/B.tsx', ['src/L.tsx'])], dynamic: [], sources: [] }

  it('accepts new routes when every base route is unchanged', () => {
    const head = { routes: [...base.routes, route('c', 'src/C.tsx')], dynamic: [], sources: [] }
    expect(compareRouteTables(base, head)).toEqual([])
  })

  it('reports removed routes and changed entries or layouts', () => {
    const head = { routes: [route('a', 'src/A2.tsx'), route('b', 'src/B.tsx', [])], dynamic: [], sources: [] }
    expect(compareRouteTables(base, head).map((c) => c.detail)).toEqual([
      'route /a changed: entry src/A.tsx → src/A2.tsx; modules [src/A.tsx] → [src/A2.tsx]',
      'route /b changed: layouts [src/L.tsx] → []',
    ])
    expect(compareRouteTables(base, { routes: [base.routes[0] as RouteEntry], dynamic: [], sources: [] }).map((c) => c.detail)).toEqual(['route /b (b) was removed'])
  })

  it('explains removed lines of widened imports only', () => {
    const before = "import { a } from './m'\nimport {\n  x,\n  y,\n} from './n'\nimport z from './z'\nconst keep = 1\n"
    const after = "import { a, b } from './m'\nimport {\n  x,\n  y,\n  w,\n} from './n'\nimport { z2 } from './z'\nconst keep = 2\n"
    // Line 1 (widened), lines 2-5 (widened multi-line); line 6 lost its default import; line 7 is code.
    expect(unexplainedRemovedLines('r.ts', before, after, [1, 4, 6, 7])).toEqual([6, 7])
    expect(unexplainedRemovedLines('r.ts', before, 'import {', [1])).toEqual([1])
    expect(unexplainedRemovedLines('r.ts', before, after, [])).toEqual([])
  })
})

describe('barrel rule', () => {
  const base = "export { A } from './A'\nexport * from './B'\n"

  it('accepts new export declarations and new names in an existing list (generated clients)', () => {
    expect(checkBarrelAdditive('index.ts', base, `${base}export { C } from './C'\nexport type { T } from './T'\n`)).toEqual({ additive: true, problems: [] })
    expect(checkBarrelAdditive('index.ts', base, "export { A, Z } from './A'\nexport * from './B'\n")).toEqual({ additive: true, problems: [] })
    expect(checkBarrelAdditive('index.ts', "export type { T, U } from './types'\n", "export type { S, T, U } from './types'\n").additive).toBe(true)
  })

  it('rejects removed or edited declarations and non-export statements', () => {
    expect(checkBarrelAdditive('index.ts', base, "export { Z } from './A'\nexport * from './B'\n").problems).toEqual([`export removed or changed: "export { A } from './A'"`])
    expect(checkBarrelAdditive('index.ts', base, "export { A as B } from './A'\nexport * from './B'\n").problems).toEqual([`export removed or changed: "export { A } from './A'"`])
    expect(checkBarrelAdditive('index.ts', base, "export type { A } from './A'\nexport * from './B'\n").problems).toEqual([`export removed or changed: "export { A } from './A'"`])
    expect(checkBarrelAdditive('index.ts', base, "export { A } from './A2'\nexport * from './B'\n").additive).toBe(false)
    expect(checkBarrelAdditive('index.ts', base, `${base}const x = 1\n`).problems).toEqual(['the head version contains a statement that is not an export declaration (not a pure barrel): "const x = 1"'])
    expect(checkBarrelAdditive('index.ts', base, 'export {').additive).toBe(false)
  })

  it('ignores whitespace-only reformatting of a declaration', () => {
    expect(checkBarrelAdditive('index.ts', "export {A} from './A'", "export {A}   from './A'\nexport { B } from './B'").additive).toBe(true)
  })
})

describe('i18n rule', () => {
  it('accepts new keys, nested too', () => {
    expect(checkI18nAdditive('{"a":"1","n":{"x":"2"}}', '{"a":"1","n":{"x":"2","y":"3"},"b":"4"}')).toEqual({ additive: true, problems: [] })
  })

  it('rejects changed values, removed keys and type changes', () => {
    expect(checkI18nAdditive('{"a":"1","n":{"x":"2"},"l":[1]}', '{"a":"2","n":"flat","l":[1,2]}').problems).toEqual(['value of a changed', 'n is no longer an object', 'value of l changed'])
    expect(checkI18nAdditive('{"a":"1","b":"2"}', '{"a":"1"}').problems).toEqual(['key b was removed'])
  })

  it('throws a parse error for invalid JSON', () => {
    expect(() => checkI18nAdditive('{}', '{')).toThrow(JsonParseError)
  })
})
