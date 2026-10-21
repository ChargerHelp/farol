import ts from 'typescript'
import type { ChangedFile } from '../git/types.js'
import { compareStrings } from '../output/order.js'
import type { SecurityFinding, SecuritySignal } from '../output/schema.js'
import { parseIsolated } from '../project/parse.js'
import { isCodeFile } from './paths.js'

type Rule = SecurityFinding['rule']
type Level = SecurityFinding['severity']

/** Token formats of well-known providers: a literal matching one is a leaked credential. */
const TOKEN_FORMATS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{50,}/, 'GitHub fine-grained token'],
  [/xox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/sk_live_[A-Za-z0-9]{20,}/, 'Stripe live secret key'],
  [/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/, 'OpenAI-style secret key'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JSON Web Token'],
]
const SECRET_NAME = /(secret|passw(or)?d|pwd|token|api[_-]?key|private[_-]?key|client[_-]?secret|auth)/i
const SAFE_HTTP = ['http://localhost', 'http://127.0.0.1', 'http://0.0.0.0', 'http://www.w3.org/', 'http://example.com', 'http://schemas.']

/** Shannon entropy in bits per character: random secrets are high, words and identifiers are low. */
export function entropy(text: string): number {
  const counts = new Map<string, number>()
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) bits -= (n / text.length) * Math.log2(n / text.length)
  return bits
}

function nameOf(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  return undefined
}

function calleeName(call: ts.CallExpression | ts.NewExpression): { object: string | undefined; name: string | undefined } {
  const callee = call.expression
  if (ts.isPropertyAccessExpression(callee)) return { object: nameOf(callee.expression), name: callee.name.text }
  return { object: undefined, name: nameOf(callee) }
}

/** Name a string literal is assigned to (variable, property, JSX attribute), to spot `apiKey = "…"`. */
function assignedName(literal: ts.Node): string | undefined {
  const parent = literal.parent as ts.Node | undefined
  if (!parent) return undefined
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) return nameOf(parent.name)
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return nameOf(parent.left)
  if (ts.isJsxAttribute(parent)) return nameOf(parent.name)
  return undefined
}

/**
 * Security-sensitive constructs on added lines, found on the TypeScript AST: XSS sinks, dynamic code execution,
 * leaked credentials, `javascript:` URLs, unsafe cross-window messaging, insecure links and plain-HTTP URLs.
 */
export function findSecurityIssues(path: string, code: string, addedLines: ReadonlySet<number>): SecurityFinding[] {
  const { sourceFile: sf } = parseIsolated(path, code)
  const lines = code.split('\n')
  const out: SecurityFinding[] = []
  const report = (node: ts.Node, rule: Rule, severity: Level, message: string): void => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    if (addedLines.has(line)) out.push({ path, line, rule, severity, message, text: (lines[line - 1] ?? '').trim().slice(0, 200) })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const name = nameOf(node.name)
      if (name === 'dangerouslySetInnerHTML') report(node, 'dangerously-set-inner-html', 'high', 'raw HTML rendered with dangerouslySetInnerHTML: sanitize it (e.g. DOMPurify) or render text')
      if (name === 'target' && node.initializer && ts.isStringLiteral(node.initializer) && node.initializer.text === '_blank') {
        const attrs = (node.parent).properties
        const rel = attrs.find((a) => ts.isJsxAttribute(a) && nameOf(a.name as ts.Node) === 'rel')
        const relText = rel && ts.isJsxAttribute(rel) && rel.initializer && ts.isStringLiteral(rel.initializer) ? rel.initializer.text : ''
        if (!relText.includes('noopener') && !relText.includes('noreferrer')) report(node, 'target-blank', 'low', 'target="_blank" without rel="noopener noreferrer"')
      }
    } else if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'dangerouslySetInnerHTML') {
      report(node, 'dangerously-set-inner-html', 'high', 'raw HTML passed through dangerouslySetInnerHTML: sanitize it or render text')
    } else if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.EqualsToken || node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
      const name = ts.isPropertyAccessExpression(node.left) ? node.left.name.text : undefined
      if (name === 'innerHTML' || name === 'outerHTML') report(node, 'inner-html', 'high', `assignment to ${name}: an XSS sink, use textContent or sanitize`)
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const { object, name } = calleeName(node)
      const first = node.arguments?.[0]
      if (name === 'eval' && object === undefined) report(node, 'eval', 'high', 'eval() executes arbitrary code')
      else if (name === 'Function' && (object === undefined || object === 'window' || object === 'globalThis')) report(node, 'eval', 'high', 'Function constructor executes arbitrary code')
      else if ((name === 'setTimeout' || name === 'setInterval') && first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) report(node, 'string-timer', 'medium', `${name} with a string evaluates code`)
      else if (name === 'insertAdjacentHTML') report(node, 'inner-html', 'high', 'insertAdjacentHTML: an XSS sink, sanitize the HTML')
      else if ((name === 'write' || name === 'writeln') && object === 'document') report(node, 'document-write', 'medium', `document.${name} writes raw HTML`)
      else if (name === 'postMessage' && node.arguments?.[1] && ts.isStringLiteralLike(node.arguments[1]) && node.arguments[1].text === '*') report(node, 'postmessage-wildcard', 'medium', 'postMessage to any origin ("*"): pass the target origin')
    } else if (ts.isStringLiteralLike(node)) {
      const text = node.text
      const token = TOKEN_FORMATS.find(([pattern]) => pattern.test(text))
      if (token) report(node, 'hardcoded-secret', 'high', `looks like a ${token[1]} in the code: move it to a secret store and rotate it`)
      else if (text.trim().toLowerCase().startsWith('javascript:')) report(node, 'javascript-url', 'high', 'javascript: URL executes code when followed')
      else if (text.startsWith('http://') && !SAFE_HTTP.some((safe) => text.startsWith(safe))) report(node, 'insecure-url', 'low', 'plain-HTTP URL: use https')
      else {
        const name = assignedName(node)
        if (name !== undefined && SECRET_NAME.test(name) && text.length >= 16 && !text.includes(' ') && entropy(text) >= 3.5) {
          report(node, 'hardcoded-secret', 'medium', `"${name}" holds a high-entropy string: possibly a hard-coded secret`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 }

/** Security findings on the added lines of changed code files (tests and stories are skipped by the caller). */
export function securitySignal(files: readonly ChangedFile[], readHead: (path: string) => string | undefined, skip: (path: string) => boolean): SecuritySignal {
  const findings: SecurityFinding[] = []
  for (const file of files) {
    if (file.status === 'deleted' || file.added.length === 0 || !isCodeFile(file.path) || skip(file.path)) continue
    const code = readHead(file.path)
    if (code === undefined) throw new Error(`internal: head content of ${file.path} is not available`)
    findings.push(...findSecurityIssues(file.path, code, new Set(file.added.map((l) => l.line))))
  }
  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || compareStrings(a.path, b.path) || a.line - b.line || compareStrings(a.rule, b.rule))
  return {
    status: 'ok',
    findings,
    summary: { high: findings.filter((f) => f.severity === 'high').length, medium: findings.filter((f) => f.severity === 'medium').length, low: findings.filter((f) => f.severity === 'low').length },
  }
}
