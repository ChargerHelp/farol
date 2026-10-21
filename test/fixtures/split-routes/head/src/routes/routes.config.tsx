import HomePage from '../pages/HomePage'
import { ProductsPage } from '../pages/ProductsPage'
import { AboutPage } from '@/pages/AboutPage'
import { SEGMENTS } from './routes.consts'
import { settingsPage, ordersPage } from './routes.modules'

export const APP_ROUTES = [
  { index: true, element: <HomePage /> },
  { path: SEGMENTS.products, element: <ProductsPage /> },
  { path: SEGMENTS.about, Component: AboutPage },
  { path: SEGMENTS.settings, lazy: settingsPage },
  { path: 'orders', lazy: ordersPage },
]
