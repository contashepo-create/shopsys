import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Sidebar } from './Sidebar.tsx'
import { MenuBar } from './MenuBar.tsx'
import { Header } from './Header.tsx'
import { branchIdentityMissingFields, useAppStore } from '../../stores/app.store.ts'
import { WindowHost } from '../windows/WindowHost.tsx'
import { DemoDataPanel } from '../../dev/DemoDataPanel.tsx'
import { CommandPalette } from '../components/CommandPalette.tsx'
import { LanStatusBar } from '../components/LanStatusBar.tsx'
import { RenewalNoticeBar } from '../components/RenewalNoticeBar.tsx'

function BranchIdentityNoticeBar() {
  const activeBranchContext = useAppStore((s) => s.activeBranchContext)
  const setup = useAppStore((s) => s.setup)
  const einvoice = useAppStore((s) => s.einvoice)
  const location = useLocation()
  if (!activeBranchContext || activeBranchContext.isMain || location.pathname === '/settings/company') return null
  const missing = branchIdentityMissingFields(setup, einvoice)
  if (!missing.length) return null
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/95 px-3 py-1.5 text-center text-[11.5px] font-bold text-slate-950" role="status" data-branch-identity-notice>
      <AlertTriangle size={14} className="shrink-0" />
      <span>
        هوية «{setup.shopName || activeBranchContext.nameAr}» غير مكتملة ({missing.join('، ')}) — تُطبع مستنداته بالاسم فقط دون استعارة بيانات المنشأة الرئيسية.
      </span>
      <Link to="/settings/company" className="shrink-0 underline underline-offset-2 hover:text-slate-700">استكمال الهوية</Link>
    </div>
  )
}

export function MainLayout({ title, children }: { title: string; children: ReactNode }) {
  const location = useLocation()
  const navigationMode = useAppStore((s) => s.appearance.navigationMode)
  const updateAppearance = useAppStore((s) => s.updateAppearance)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('shopsys-sidebar-collapsed') === '1')
  /* مستند الفاتورة (طلب المالك): **صفحة كاملة مدمجة في الشاشة الرئيسية** — لا نافذة
     منبثقة ولا شاشة منفصلة بلا قوائم. يبقى شريط القوائم/الشريط الجانبي كما في بقية
     الشاشات، ويُسحب شريط العنوان العام فقط لأن للمستند شريط عنوانه (رقمه وحالته
     وأزراره)، ثم يملأ المستند بقية الارتفاع بلا تمرير للصفحة. */
  const isInvoiceWorkspace = /^\/(sales|purchases)\/invoices\/new$/.test(location.pathname)
  const mainClass = isInvoiceWorkspace ? 'invoice-embedded-main' : 'p-4 lg:p-6'
  const shellClass = isInvoiceWorkspace ? 'invoice-embedded-layout' : 'min-h-screen'
  const toggle = () => setCollapsed((value) => { const next = !value; localStorage.setItem('shopsys-sidebar-collapsed', next ? '1' : '0'); return next })
  // الافتراضي (طلب المالك): شريط قوائم علوي بنمط ويندوز/VS Code، وزر في نهايته يحوّله لشريط جانبي
  if (navigationMode === 'topbar') return <div className={`top-navigation-layout ${shellClass}`} dir="rtl"><MenuBar onSwitchToSidebar={() => updateAppearance({ navigationMode: 'sidebar' })}/><LanStatusBar/><RenewalNoticeBar/><BranchIdentityNoticeBar/>{!isInvoiceWorkspace && <Header title={title}/>}<main className={mainClass}>{children}</main><WindowHost /><CommandPalette /><DemoDataPanel /></div>
  return <div className={`flex ${shellClass}`} dir="rtl"><Sidebar collapsed={collapsed} onToggle={toggle}/><div className="flex-1 flex flex-col min-w-0"><LanStatusBar/><RenewalNoticeBar/><BranchIdentityNoticeBar/>{!isInvoiceWorkspace && <Header title={title}/>}<main className={`flex-1 ${mainClass}`}>{children}</main></div><WindowHost /><CommandPalette /><DemoDataPanel /></div>
}
