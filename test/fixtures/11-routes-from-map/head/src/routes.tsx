import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import HomePage from './pages/HomePage'
import { ProductsPage } from './pages/ProductsPage'
import { AboutPage } from '@/pages/AboutPage'

const simplePages = [
  { path: 'products', Page: ProductsPage },
  { path: 'about', Page: AboutPage },
]

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      ...simplePages.map(({ path, Page }) => ({ path, element: <Page /> })),
      { path: 'settings', lazy: () => import('./pages/SettingsPage') }
    ]
  }
])
