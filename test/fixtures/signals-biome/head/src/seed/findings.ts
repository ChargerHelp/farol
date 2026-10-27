// Ünïcödé — ★ multi-byte text before the findings
export function compare(a: number, input: any): boolean {
  const unused = 1
  a = a + 1
  // biome-ignore lint/suspicious/noDoubleEquals: legacy comparison
  if (a == 2) return true
  eval('1 + 1')
  return a == input
}
