import { buildProgram } from './program.js'

const program = buildProgram()
program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`farol: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
})
