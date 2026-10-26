import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { OutputSchema } from '../../src/output/schema.js'
import { createScenarioRepo, type ScenarioRepo } from '../helpers/repo.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ACTION = readFileSync(join(ROOT, 'action', 'action.yml'), 'utf8')
/** The GitHub Marketplace entry at the repository root: the same action, with dist/ next to it. */
const ROOT_ACTION = readFileSync(join(ROOT, 'action.yml'), 'utf8')
const WORKFLOW = readFileSync(join(ROOT, 'examples', 'workflow.yml'), 'utf8')

/** The bash script of the composite step (the `run: |` block scalar). */
function actionScript(source = ACTION): string {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.trim() === 'run: |')
  const indent = ' '.repeat((lines[start] ?? '').indexOf('run:') + 2)
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith(indent)) break
    body.push(line.slice(indent.length))
  }
  return body.join('\n')
}

/** Input names declared under `inputs:` (two-space indented keys). */
function declaredInputs(): string[] {
  const section = ACTION.slice(ACTION.indexOf('\ninputs:\n'), ACTION.indexOf('\nruns:\n'))
  return section
    .split('\n')
    .filter((l) => /^ {2}[a-z-]+:$/.test(l))
    .map((l) => l.trim().slice(0, -1))
}

const repos: ScenarioRepo[] = []
const tmp = mkdtempSync(join(tmpdir(), 'farol-action-'))
afterAll(() => {
  for (const r of repos) r.repo.cleanup()
  rmSync(tmp, { recursive: true, force: true })
})

function runAction(env: Record<string, string>, source = ACTION, actionPath = join(ROOT, 'action')): { code: number | null; stderr: string; stdout: string } {
  const r = spawnSync('bash', ['-c', actionScript(source)], {
    env: { ...process.env, GITHUB_ACTION_PATH: actionPath, RS_BASE: '', RS_HEAD: '', RS_COVERAGE: '', RS_ESLINT: '', RS_AUDIT: '', RS_OUT: 'farol.json', RS_IN: 'farol.json', RS_HTML_OUT: 'farol.html', RS_REPORT_URL: '', RS_SINCE: '', RS_USAGE: '', RS_DAYS: '', RS_REVIEWERS_FILE: '', RS_NEW_COMMENT: 'false', RS_SINCE_IN: '', RS_SINCE_REPORT_URL: '', RS_REVIEWERS: 'false', RS_PR: '', RS_REPO: '', RS_CONFIG: 'farol.config.json', RS_CWD: '', RS_VERBOSE: 'false', ...env },
    encoding: 'utf8',
  })
  return { code: r.status, stderr: r.stderr, stdout: r.stdout }
}

describe('composite action', () => {
  it('declares every input the example workflow uses', () => {
    const inputs = declaredInputs()
    expect(inputs).toEqual(['command', 'base', 'head', 'coverage', 'eslint', 'audit', 'usage', 'new-comment', 'since-in', 'since-report-url', 'reviewers-file', 'days', 'since', 'reviewers', 'out', 'in', 'html-out', 'report-url', 'pr', 'repo', 'config', 'cwd', 'verbose'])
    const used = [...WORKFLOW.matchAll(/^ {10}([a-z]+):/gm)].map((m) => m[1] ?? '')
    const withBlocks = WORKFLOW.split('uses: winnin/farol/action@main').slice(1).map((b) => b.split('\n').slice(1, 9).join('\n'))
    for (const block of withBlocks) for (const name of [...block.matchAll(/^ {10}([a-z-]+):/gm)].map((m) => m[1] ?? '')) expect(inputs).toContain(name)
    expect(used.length).toBeGreaterThan(0)
    expect(WORKFLOW).not.toContain('pull_request_target')
  })

  it('runs analyze through dist/cli.js with the inputs', () => {
    const s = createScenarioRepo('05-shared-component')
    repos.push(s)
    const out = join(tmp, 'farol.json')
    const r = runAction({ RS_COMMAND: 'analyze', RS_BASE: s.base, RS_HEAD: s.head, RS_OUT: out, RS_CWD: s.repo.dir })
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    expect(OutputSchema.parse(JSON.parse(readFileSync(out, 'utf8'))).classification).toBe('touches-existing')
  })

  it('passes comment inputs to the CLI and rejects unknown commands', () => {
    const r = runAction({ RS_COMMAND: 'comment', RS_IN: join(tmp, 'farol.json'), RS_PR: '7', GITHUB_REPOSITORY: 'acme/shop', GITHUB_TOKEN: '' })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('GITHUB_TOKEN is not set')
    const bad = runAction({ RS_COMMAND: 'deploy' })
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain("input 'command' must be 'analyze', 'html', 'comment', 'usage' or 'reviewers'")
  })

  it('keeps the Marketplace action at the root in sync with action/action.yml', () => {
    // Same inputs and steps; only the name, the description, the header comment and the path to dist/ differ.
    const body = (text: string): string => text.split('\n').filter((l) => !l.startsWith('#') && !l.startsWith('name: ') && !l.startsWith('description: ')).join('\n')
    expect(body(ROOT_ACTION)).toBe(body(ACTION).replace('$GITHUB_ACTION_PATH/../dist/cli.js', '$GITHUB_ACTION_PATH/dist/cli.js'))
    expect(ROOT_ACTION).toMatch(/^branding:\n {2}icon: \S+\n {2}color: \S+$/m)
    const description = /^description: (.*)$/m.exec(ROOT_ACTION)?.[1] ?? ''
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(125)
  })

  it('runs the root action script against dist/cli.js', () => {
    const r = runAction({ RS_COMMAND: 'html', RS_IN: join(tmp, 'farol.json'), RS_HTML_OUT: join(tmp, 'root.html') }, ROOT_ACTION, ROOT)
    expect(r.code).toBe(0)
    expect(readFileSync(join(tmp, 'root.html'), 'utf8')).toContain('window.FAROL = ')
  })

  it('renders the HTML report from the JSON', () => {
    const html = join(tmp, 'farol.html')
    const r = runAction({ RS_COMMAND: 'html', RS_IN: join(tmp, 'farol.json'), RS_HTML_OUT: html, RS_PR: '7' })
    expect(r.code).toBe(0)
    expect(readFileSync(html, 'utf8')).toContain('window.FAROL = ')
  })
})
