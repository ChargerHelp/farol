import { describe, expect, it } from 'vitest'
import { entropy, findSecurityIssues } from '../../src/signals/security.js'

const all = (code: string): Set<number> => new Set(code.split('\n').map((_, i) => i + 1))
const rules = (code: string, file = 'a.tsx') => findSecurityIssues(file, code, all(code)).map((f) => [f.line, f.rule, f.severity])

describe('static security analysis', () => {
  it('finds XSS sinks and dynamic code execution', () => {
    const code = [
      'export const A = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />',
      'el.innerHTML = value',
      'el.insertAdjacentHTML("beforeend", value)',
      'document.write(value)',
      'eval(input)',
      'const f = new Function("return 1")',
      'setTimeout("doIt()", 10)',
      'setTimeout(() => doIt(), 10)',
      'window.parent.postMessage(data, "*")',
      'window.parent.postMessage(data, "https://app.example")',
    ].join('\n')
    expect(rules(code)).toEqual([
      [1, 'dangerously-set-inner-html', 'high'],
      [2, 'inner-html', 'high'],
      [3, 'inner-html', 'high'],
      [4, 'document-write', 'medium'],
      [5, 'eval', 'high'],
      [6, 'eval', 'high'],
      [7, 'string-timer', 'medium'],
      [9, 'postmessage-wildcard', 'medium'],
    ])
  })

  it('finds credentials, javascript: URLs, unsafe links and plain HTTP', () => {
    const code = [
      'const aws = "AKIAABCDEFGHIJKLMNOP"',
      `const gh = "ghp_${'a1B2'.repeat(9)}"`,
      'const apiKey = "Zx9Kq2Lm8Rt4Vb7Np3Wd"',
      'const label = "the api key goes here"',
      'const href = "javascript:alert(1)"',
      'export const L = () => <a href="https://x.dev" target="_blank">x</a>',
      'export const M = () => <a href="https://x.dev" target="_blank" rel="noopener noreferrer">x</a>',
      'const api = "http://api.example.org/v1"',
      'const ns = "http://www.w3.org/2000/svg"',
      'const dev = "http://localhost:3000"',
    ].join('\n')
    expect(rules(code)).toEqual([
      [1, 'hardcoded-secret', 'high'],
      [2, 'hardcoded-secret', 'high'],
      [3, 'hardcoded-secret', 'medium'],
      [5, 'javascript-url', 'high'],
      [6, 'target-blank', 'low'],
      [8, 'insecure-url', 'low'],
    ])
  })

  it('only reports added lines; entropy separates random strings from words', () => {
    expect(findSecurityIssues('a.ts', 'eval(a)\neval(b)', new Set([2])).map((f) => f.line)).toEqual([2])
    expect(entropy('aaaaaaaa')).toBe(0)
    expect(entropy('Zx9Kq2Lm8Rt4Vb7Np3Wd')).toBeGreaterThan(3.5)
  })
})
