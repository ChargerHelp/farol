/** Locale-independent string comparison used everywhere output order matters. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Sorted copy of unique strings. */
export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings)
}
