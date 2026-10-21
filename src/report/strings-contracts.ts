/** User-facing text of the contract changes (re-exported by strings.ts). */
export const CONTRACT_TEXT = {
  label: 'Contracts',
  title: 'Contract changes',
  intro: 'What each endpoint receives (parameters, body) and returns, compared between the base and the head. Breaking: clients built for the base can fail. Dangerous: they may misbehave. Safe: compatible additions. Callers come from Datadog client spans.',
  levels: { breaking: 'breaking', dangerous: 'dangerous', safe: 'safe' } as const,
  summary: (breaking: number, dangerous: number, safe: number) =>
    breaking + dangerous + safe === 0
      ? 'no change to what endpoints receive or return'
      : [breaking > 0 ? `${breaking} endpoint${breaking === 1 ? '' : 's'} with breaking changes` : '', dangerous > 0 ? `${dangerous} with dangerous changes` : '', safe > 0 ? `${safe} with safe changes only` : ''].filter((s) => s !== '').join(', '),
  readable: (n: number) => `${n} endpoint contract${n === 1 ? '' : 's'} read`,
  more: (n: number) => `+${n} more`,
  calledBy: (list: string) => `called by ${list}`,
  noCallers: 'no caller seen in Datadog',
  callersUnknown: 'callers unknown (no usage report)',
  fact: (n: number) => `${n} breaking contract change${n === 1 ? '' : 's'}`,
  factDangerous: (n: number) => `${n} contract change${n === 1 ? '' : 's'} to check`,
  safeTitle: (n: number) => `Safe changes only: ${n} endpoint${n === 1 ? '' : 's'}`,
  columns: { level: 'Level', where: 'Where', change: 'Change' } as const,
}
