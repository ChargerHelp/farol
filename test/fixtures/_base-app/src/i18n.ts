import messages from './locales/pt-BR.json'

export function t(key: string): string {
  return (messages as Record<string, string>)[key] ?? key
}
