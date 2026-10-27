import ts from 'typescript'
import type { ChangedFile } from '../git/types.js'
import { compareStrings } from '../output/order.js'
import type { SuppressionKind, SuppressionsSignal } from '../output/schema.js'
import { parseIsolated } from '../project/parse.js'
import { isCodeFile } from './paths.js'

type Item = SuppressionsSignal['items'][number]

const TEXT_TOKENS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.JsxTextAllWhiteSpaces,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
])

/** Directive prefixes and their kinds. A prefix only matches a whole word (see `directiveOf`), so the order does not matter. */
const DIRECTIVES: [string, SuppressionKind][] = [
  ['eslint-disable-next-line', 'eslint-disable-next-line'],
  ['eslint-disable-line', 'eslint-disable-line'],
  ['eslint-disable', 'eslint-disable'],
  ['@ts-expect-error', 'ts-expect-error'],
  ['@ts-ignore', 'ts-ignore'],
  ['@ts-nocheck', 'ts-nocheck'],
  // `biome-ignore-end` closes a range and is not reported: the range counts once, at `biome-ignore-start`.
  ['biome-ignore', 'biome-ignore'],
  ['biome-ignore-all', 'biome-ignore-all'],
  ['biome-ignore-start', 'biome-ignore-start'],
]

/** Biome categories that switch no check off: the formatter and assists (such as sorting imports). */
const BIOME_STYLE_CATEGORIES = new Set(['format', 'assist'])

function commentBody(comment: string): string {
  let body = comment.startsWith('//') ? comment.slice(2) : comment.slice(2, -2)
  body = body.trimStart()
  while (body.startsWith('*')) body = body.slice(1).trimStart()
  return body
}

function directiveOf(comment: string): SuppressionKind | undefined {
  const body = commentBody(comment)
  for (const [prefix, kind] of DIRECTIVES) {
    if (!body.startsWith(prefix)) continue
    const next = body.charAt(prefix.length)
    // `eslint-disable-line` must not match `eslint-disable-lines`; any separator (space, colon, end) is fine.
    if (next !== '' && /[A-Za-z0-9-]/.test(next)) continue
    // Biome reads every space-separated category before the `:`: skip only when all of them are style categories.
    const categories = (body.slice(prefix.length).split(':', 1)[0] ?? '').split(/\s+/).filter((c) => c !== '').map((c) => c.split(/[/(]/, 1)[0] ?? '')
    if (prefix.startsWith('biome-') && categories.length > 0 && categories.every((c) => BIOME_STYLE_CATEGORIES.has(c))) return undefined
    return kind
  }
  return undefined
}

/**
 * Suppressions added by the diff: eslint-disable comments, @ts-ignore/@ts-expect-error/@ts-nocheck comments,
 * Biome ignore comments (not the formatter's or assists'), `as any` and `: any`. Comments come from the TypeScript scanner's trivia of every token of the parsed file,
 * so the same text inside a string, a template or JSX text is never reported.
 */
export function findSuppressions(path: string, code: string, addedLines: ReadonlySet<number>): Item[] {
  const { sourceFile: sf } = parseIsolated(path, code)
  const lines = code.split('\n')
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1
  const items: Item[] = []
  const add = (pos: number, kind: SuppressionKind): void => {
    const line = lineOf(pos)
    if (addedLines.has(line)) items.push({ path, line, kind, text: (lines[line - 1] ?? '').trim().slice(0, 200) })
  }
  // Tokens whose text is data, not trivia: a "comment" inside them is not a comment.
  const textRanges: [number, number][] = []
  const leaves: ts.Node[] = []
  const collect = (node: ts.Node): void => {
    const children = node.getChildren(sf)
    if (children.length === 0) {
      leaves.push(node)
      if (TEXT_TOKENS.has(node.kind)) textRanges.push([node.getStart(sf), node.end])
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const parent = node.parent as ts.Node | undefined
      if (parent && ts.isAsExpression(parent)) add(node.getStart(sf), 'as-any')
      else if (parent && !ts.isTypeAssertionExpression(parent) && (parent as { type?: ts.Node }).type === node && code.slice(0, node.getStart(sf)).trimEnd().endsWith(':')) add(node.getStart(sf), 'any-annotation')
    }
    for (const child of children) collect(child)
  }
  collect(sf)
  const inText = (pos: number): boolean => textRanges.some(([start, end]) => pos >= start && pos < end)
  const seen = new Set<number>()
  for (const leaf of leaves) {
    if (TEXT_TOKENS.has(leaf.kind)) continue
    for (const range of [...(ts.getLeadingCommentRanges(code, leaf.pos) ?? []), ...(ts.getTrailingCommentRanges(code, leaf.end) ?? [])]) {
      if (seen.has(range.pos) || inText(range.pos)) continue
      seen.add(range.pos)
      const kind = directiveOf(code.slice(range.pos, range.end))
      if (kind) add(range.pos, kind)
    }
  }
  items.sort((a, b) => a.line - b.line || compareStrings(a.kind, b.kind))
  return items
}

export function suppressionsSignal(files: readonly ChangedFile[], readHead: (path: string) => string | undefined): SuppressionsSignal {
  const items: Item[] = []
  for (const file of files) {
    if (file.status === 'deleted' || file.added.length === 0 || !isCodeFile(file.path)) continue
    const code = readHead(file.path)
    if (code === undefined) throw new Error(`internal: head content of ${file.path} is not available`)
    items.push(...findSuppressions(file.path, code, new Set(file.added.map((l) => l.line))))
  }
  items.sort((a, b) => compareStrings(a.path, b.path) || a.line - b.line || compareStrings(a.kind, b.kind))
  return { status: 'ok', items }
}
