export function topBrands(limit: number) {
  return Array.from({ length: limit }, (_, i) => ({ id: String(i), name: `#${i}` }))
}
