import { Button } from '@/components'
import { formatPrice } from '../lib/format'

export function Component() {
  return (
    <div>
      <p>Settings, limit {formatPrice(100)}</p>
      <Button label="Save" />
    </div>
  )
}
