import { execFile } from 'node:child_process'

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

// Flags that make git output independent of the user's configuration.
const BASE_ARGS = ['-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', '-c', 'color.ui=false']
const MAX_BUFFER = 1024 * 1024 * 1024

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_PAGER: 'cat' }
}

/** Runs git with an argument vector (never through a shell) and returns stdout. */
export function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', [...BASE_ARGS, ...args], { cwd, maxBuffer: MAX_BUFFER, env: gitEnv(), encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message
        reject(new GitError(`git ${args.join(' ')} failed: ${detail}`, args, stderr))
        return
      }
      resolve(stdout)
    })
  })
}

/** Runs git, writes `input` to its stdin and returns stdout as raw bytes. */
export function runGitBuffer(cwd: string, args: readonly string[], input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', [...BASE_ARGS, ...args], { cwd, maxBuffer: MAX_BUFFER, env: gitEnv(), encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.toString('utf8').trim() || error.message
        reject(new GitError(`git ${args.join(' ')} failed: ${detail}`, args, stderr.toString('utf8')))
        return
      }
      resolve(stdout)
    })
    child.stdin?.end(input)
  })
}
