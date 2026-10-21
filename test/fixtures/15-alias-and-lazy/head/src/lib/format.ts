export function formatPrice(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}
