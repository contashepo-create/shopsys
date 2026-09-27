import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar.tsx'
import { TopNavigation } from './TopNavigation.tsx'
import { Header } from './Header.tsx'
import { useAppStore } from '../../stores/app.store.ts'

export function MainLayout({ title, children }: { title: string; children: ReactNode }) {
  const location = useLocation()
  const navigationMode = useAppStore((s) => s.appearance.navigationMode)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('shopsys-sidebar-collapsed') === '1')
  const isInvoiceWorkspace = /^\/(sales|purchases)\/invoices\/new$/.test(location.pathname)
  const toggle = () => setCollapsed((value) => { const next = !value; localStorage.setItem('shopsys-sidebar-collapsed', next ? '1' : '0'); return next })
  if (isInvoiceWorkspace) return <div className="invoice-standalone-layout min-h-screen" dir="rtl"><main className="min-h-screen">{children}</main></div>
  if (navigationMode === 'topbar') return <div className="top-navigation-layout min-h-screen" dir="rtl"><TopNavigation/><Header title={title}/><main className="p-4 lg:p-6">{children}</main></div>
  return <div className="flex min-h-screen" dir="rtl"><Sidebar collapsed={collapsed} onToggle={toggle}/><div className="flex-1 flex flex-col min-w-0"><Header title={title}/><main className="flex-1 p-4 lg:p-6">{children}</main></div></div>
}
