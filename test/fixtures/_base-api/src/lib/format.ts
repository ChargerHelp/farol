export function maskEmail(email: string): string {
  return email.replace(/^(.).*@/, '$1***@')
}
