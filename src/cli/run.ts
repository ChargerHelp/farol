import { UsageError } from '../config/load.js'

export const EXIT_OK = 0
export const EXIT_USAGE = 1
export const EXIT_FAILURE = 2

/** Maps errors to exit codes: usage/config errors → 1, anything else → 2. Never swallows the message. */
export async function runAction(action: () => Promise<number | undefined>): Promise<void> {
  try {
    process.exitCode = (await action()) ?? EXIT_OK
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`farol: ${message}\n`)
    process.exitCode = error instanceof UsageError ? EXIT_USAGE : EXIT_FAILURE
  }
}

/** Writes text to stdout, waiting for the stream to drain so large outputs are not truncated on exit. */
export function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
