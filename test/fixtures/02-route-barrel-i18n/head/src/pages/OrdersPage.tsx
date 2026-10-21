import { Badge, Card } from '@/components'
import { t } from '@/i18n'

export function OrdersPage() {
  return (
    <Card title={t('orders.title')}>
      <Badge text={t('orders.empty')} />
    </Card>
  )
}
