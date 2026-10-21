import { Button, Card } from '@/components'
import { formatPrice } from '@/lib/format'
import type { Product } from '@/types/product'
import './products.css'

const products: Product[] = [{ id: '1', name: 'Lamp', price: 10, kind: 'home' }]

export function ProductsPage() {
  return (
    <Card title="Products">
      {products.map((p) => (
        <div key={p.id}>
          {p.name} {formatPrice(p.price)}
          <Button label="Buy" />
        </div>
      ))}
    </Card>
  )
}
