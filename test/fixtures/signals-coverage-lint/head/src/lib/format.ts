export function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`
}

export function formatPercent(value: number): string {
  if (value < 0) {
    return '-'
  }
  const rounded = Math.round(value * 100)
  return `${rounded}%`
}

export function formatCount(value: number): string {
  return value === 1 ? '1 item' : `${value} items`
}
