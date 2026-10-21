import { Link, Outlet } from 'react-router-dom'
import { Header } from '@/components'
import { t } from '@/i18n'

export function AppLayout() {
  return (
    <div className="app">
      <Header title={t('app.title')} />
      <nav>
        <Link to="/help">Help</Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
