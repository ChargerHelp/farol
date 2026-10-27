import { posix } from 'node:path'
import { z } from 'zod'
import type { ChangedFile } from '../git/types.js'
import { compareStrings } from '../output/order.js'
import type { SecurityFinding, SuppressionsSignal } from '../output/schema.js'
import type { Advisory } from './audit.js'
import { parseJson, ReportError } from './coverage.js'
import type { LintMessage } from './lint.js'
import { reportPathToRepo } from './paths.js'

type Statements = { start: number; end: number; count: number }[]

/**
 * `go test -coverprofile` output: `mode: set|count|atomic`, then `<import path>/<file>.go:L.C,L.C <statements> <count>`.
 * Files are named by import path: the module path is replaced by the project directory. Blocks reported several
 * times (one test binary per package) are merged, covered when any run covered them.
 */
export function parseGoCoverProfile(text: string, module: string, projectPrefix: string): Map<string, Statements> {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (!lines[0]?.startsWith('mode:')) throw new ReportError('the coverage report is neither Istanbul JSON nor a Go coverprofile (go test -coverprofile)')
  const blocks = new Map<string, Map<string, { start: number; end: number; count: number }>>()
  for (const line of lines.slice(1)) {
    const m = /^(.+\.go):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/.exec(line.trim())
    if (!m) throw new ReportError(`unexpected coverprofile line: ${line.slice(0, 120)}`)
    const [, file = '', start = '0', end = '0', count = '0'] = m
    const rel = module !== '' && file.startsWith(`${module}/`) ? file.slice(module.length + 1) : undefined
    if (rel === undefined) continue
    const path = posix.join(projectPrefix, rel)
    const perFile = blocks.get(path) ?? new Map<string, { start: number; end: number; count: number }>()
    const key = `${start}:${end}:${line.slice(file.length).split(' ')[0] ?? ''}`
    const previous = perFile.get(key)
    perFile.set(key, { start: Number(start), end: Number(end), count: Math.max(previous?.count ?? 0, Number(count)) })
    blocks.set(path, perFile)
  }
  return new Map([...blocks].map(([path, b]) => [path, [...b.values()]]))
}

const GolangciReport = z.object({
  Issues: z
    .array(z.object({ FromLinter: z.string(), Text: z.string(), Severity: z.string().optional(), Pos: z.object({ Filename: z.string(), Line: z.number().int() }).loose() }).loose())
    .nullable(),
}).loose()

/** Whether a lint report is golangci-lint JSON (`golangci-lint run --output.json.path`, or `--out-format json`). */
export function isGolangciReport(text: string): boolean {
  return text.trimStart().startsWith('{') && text.includes('"Issues"')
}

const GOSEC_HIGH = new Set(['G101', 'G201', 'G202', 'G203', 'G204', 'G304', 'G402'])

/** golangci-lint issues as lint messages, and gosec issues as security findings too. */
export function parseGolangciReport(text: string, repoRoot: string, projectPrefix: string, canonical?: (path: string) => string): { messages: LintMessage[]; gosec: Omit<SecurityFinding, 'text'>[] } {
  const raw = parseJson(text, 'golangci-lint')
  const parsed = GolangciReport.safeParse(raw)
  if (!parsed.success) throw new ReportError('the lint report is not golangci-lint JSON output')
  const messages: LintMessage[] = []
  const gosec: Omit<SecurityFinding, 'text'>[] = []
  for (const issue of parsed.data.Issues ?? []) {
    const path = reportPathToRepo(issue.Pos.Filename, repoRoot, projectPrefix, canonical) ?? issue.Pos.Filename
    messages.push({ path, line: issue.Pos.Line, rule: issue.FromLinter, severity: issue.Severity === 'warning' ? 'warning' : 'error', message: issue.Text })
    if (issue.FromLinter === 'gosec') {
      const id = /^(G\d{3})/.exec(issue.Text)?.[1] ?? ''
      gosec.push({ path, line: issue.Pos.Line, rule: 'gosec', severity: GOSEC_HIGH.has(id) ? 'high' : 'medium', message: issue.Text })
    }
  }
  return { messages, gosec }
}

/** `//nolint`, `//lint:ignore` and `#nosec` comments on the lines a PR adds to Go files. */
export function goSuppressions(files: readonly ChangedFile[], comments: readonly { file: string; line: number; text: string }[]): SuppressionsSignal['items'] {
  const added = new Map(files.map((f) => [f.path, new Set(f.added.map((l) => l.line))]))
  const items: SuppressionsSignal['items'] = []
  for (const c of comments) {
    if (!added.get(c.file)?.has(c.line)) continue
    const body = c.text.replace(/^\/\/\s*|^\/\*\s*/, '')
    const kind = body.startsWith('nolint') ? 'nolint' : body.startsWith('lint:ignore') ? 'lint-ignore' : c.text.includes('#nosec') ? 'nosec' : undefined
    if (kind) items.push({ path: c.file, line: c.line, kind, text: c.text.slice(0, 200) })
  }
  return items.sort((a, b) => compareStrings(a.path, b.path) || a.line - b.line)
}

/** Top-level JSON values of a stream (govulncheck prints one indented object per message). */
function jsonStream(text: string): unknown[] {
  const out: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) out.push(JSON.parse(text.slice(start, i + 1)))
    }
  }
  return out
}

const Osv = z.object({ id: z.string(), summary: z.string().optional(), aliases: z.array(z.string()).optional(), database_specific: z.object({ url: z.string().optional() }).loose().optional() }).loose()
const Finding = z.object({ osv: z.string(), fixed_version: z.string().optional(), trace: z.array(z.object({ module: z.string(), version: z.string().optional(), package: z.string().optional(), function: z.string().optional() }).loose()) }).loose()

/** Whether an audit report is `govulncheck -json` output. */
export function isGovulncheckReport(text: string): boolean {
  return text.includes('"osv"') || text.includes('"finding"') || text.includes('"config"')
}

/**
 * `govulncheck -json` findings as advisories on the vulnerable module. A finding whose trace reaches a function is
 * code the project calls (high); package-level (imported) is moderate; module-level (only required) is low.
 */
export function parseGovulncheckReport(text: string): { advisories: Advisory[]; dependsOn: Map<string, string[]> } {
  let messages: unknown[]
  try {
    messages = jsonStream(text)
  } catch (error) {
    throw new ReportError(`the govulncheck report is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const osvs = new Map<string, z.infer<typeof Osv>>()
  const findings: z.infer<typeof Finding>[] = []
  for (const m of messages) {
    if (typeof m !== 'object' || m === null) continue
    const record = m as Record<string, unknown>
    const osv = Osv.safeParse(record.osv)
    if (osv.success) osvs.set(osv.data.id, osv.data)
    const finding = Finding.safeParse(record.finding)
    if (finding.success) findings.push(finding.data)
  }
  const best = new Map<string, Advisory>()
  for (const f of findings) {
    const vulnerable = f.trace[0]
    if (!vulnerable) continue
    const level = vulnerable.function ? 'high' : vulnerable.package ? 'moderate' : 'low'
    const osv = osvs.get(f.osv)
    const advisory: Advisory = {
      package: vulnerable.module,
      severity: level,
      title: osv?.summary ?? f.osv,
      id: f.osv,
      url: osv?.database_specific?.url ?? `https://pkg.go.dev/vuln/${f.osv}`,
      cves: (osv?.aliases ?? []).filter((a) => a.startsWith('CVE-')),
      vulnerableRange: vulnerable.version ?? null,
      patchedVersions: f.fixed_version ?? null,
      paths: [f.trace.map((t) => t.module)],
    }
    const key = `${f.osv}\0${vulnerable.module}`
    const current = best.get(key)
    const rank = { high: 0, moderate: 1, low: 2 } as Record<string, number>
    if (!current || (rank[advisory.severity] ?? 9) < (rank[current.severity] ?? 9)) best.set(key, advisory)
  }
  return { advisories: [...best.values()].sort((a, b) => compareStrings(a.id, b.id) || compareStrings(a.package, b.package)), dependsOn: new Map() }
}
