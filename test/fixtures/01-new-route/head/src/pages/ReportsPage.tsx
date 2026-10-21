import { ReportChart } from '@/components/reports/ReportChart'
import { ReportTable } from '../components/reports/ReportTable'

export function ReportsPage() {
  return (
    <div>
      <ReportChart points={[1, 2, 3]} />
      <ReportTable rows={['a', 'b']} />
    </div>
  )
}
