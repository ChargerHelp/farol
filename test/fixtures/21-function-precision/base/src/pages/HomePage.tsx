import { Card } from '../components'
import { PRODUCT_KINDS } from '@/types/product'
import { t } from '@/i18n'
import { homeLabel } from '@/lib/labels'

export default function HomePage() {
  return (
    <Card title={t('home.title')}>
      <p>{homeLabel(PRODUCT_KINDS.length)}</p>
    </Card>
  )
}
