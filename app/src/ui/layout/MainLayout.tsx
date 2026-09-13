import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar.tsx'
import { Header } from './Header.tsx'

export function MainLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen" dir="rtl">
      {/* الشريط الجانبي على اليمين — أول عنصر في RTL */}
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
