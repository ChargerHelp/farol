export const PRODUCT_KINDS = ['home', 'office'] as const

export interface Product {
  id: string
  name: string
  price: number
  kind: (typeof PRODUCT_KINDS)[number]
  description?: string
}
