import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import HomePage from './pages/HomePage'
import { ProductsPage } from './pages/ProductsPage'
import { AboutPage } from '@/pages/AboutPage'
import { FaqPage } from './pages/FaqPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'about', Component: AboutPage },
      { path: 'settings', lazy: () => import('./pages/SettingsPage') },
      { path: 'faq', element: <FaqPage /> }
    ]
  }
])
