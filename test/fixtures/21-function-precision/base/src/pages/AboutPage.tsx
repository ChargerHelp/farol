import { Button } from '@/components'
import { aboutLabel } from '@/lib/labels'

export function AboutPage() {
  return (
    <div>
      <p>{aboutLabel()}</p>
      <Button label="Contact" />
    </div>
  )
}
