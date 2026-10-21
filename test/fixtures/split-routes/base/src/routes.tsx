import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { APP_ROUTES } from './routes/routes.config'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [...APP_ROUTES],
  },
])
