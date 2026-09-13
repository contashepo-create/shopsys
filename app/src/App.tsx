import { useEffect } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useAppStore } from './stores/app.store.ts'
import { useDataStore } from './data/repo.ts'
import { FirstRunWizard } from './ui/setup/FirstRunWizard.tsx'
import { MainLayout } from './ui/layout/MainLayout.tsx'
import { Dashboard } from './ui/pages/Dashboard.tsx'
import { PermissionsPage } from './ui/pages/PermissionsPage.tsx'
import { ItemsPage } from './ui/pages/ItemsPage.tsx'
import { WarehousesPage } from './ui/pages/WarehousesPage.tsx'
import { CustomersPage, SuppliersPage } from './ui/pages/PartiesPages.tsx'
import { GeneralSettingsPage } from './ui/pages/GeneralSettingsPage.tsx'
import { ComingSoon } from './ui/pages/ComingSoon.tsx'
import { ToastHost } from './ui/components/ui.tsx'
import { NAV_SECTIONS } from './ui/navCatalog.tsx'

function usePageTitle(): string {
  const { pathname } = useLocation()
  for (const sec of NAV_SECTIONS) {
    const child = sec.children.find((c) => c.path === pathname)
    if (child) return sec.children.length === 1 ? sec.nameAr : `${sec.nameAr} — ${child.nameAr}`
  }
  return 'ShopSys'
}

function Shell() {
  const title = usePageTitle()
  return (
    <MainLayout title={title}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings/permissions" element={<PermissionsPage />} />
        <Route path="/settings/general" element={<GeneralSettingsPage />} />
        <Route path="/inventory/items" element={<ItemsPage />} />
        <Route path="/inventory/warehouses" element={<WarehousesPage />} />
        <Route path="/parties/customers" element={<CustomersPage />} />
        <Route path="/purchases/suppliers" element={<SuppliersPage />} />
        {/* شاشات المراحل القادمة — كلها مسجلة في الراوتر منذ الآن */}
        <Route path="/pos" element={<ComingSoon title="شاشة البيع (الكاشير)" phase="المرحلة 2 — قلب المنتج" />} />
        <Route path="/sales/invoices" element={<ComingSoon title="فواتير المبيعات" phase="المرحلة 2" />} />
        <Route path="/sales/returns" element={<ComingSoon title="مرتجعات المبيعات" phase="المرحلة 3" />} />
        <Route path="/sales/shifts" element={<ComingSoon title="ورديات الكاشير" phase="المرحلة 2" />} />
        <Route path="/inventory/transfers" element={<ComingSoon title="التحويلات المخزنية" phase="المرحلة 3" />} />
        <Route path="/inventory/counting" element={<ComingSoon title="الجرد بالباركود" phase="المرحلة 3" />} />
        <Route path="/purchases/invoices" element={<ComingSoon title="فواتير الشراء" phase="المرحلة 3" />} />
        <Route path="/purchases/returns" element={<ComingSoon title="مرتجعات الشراء" phase="المرحلة 3" />} />
        <Route path="/parties/employees" element={<ComingSoon title="الموظفون" phase="المرحلة 5" />} />
        <Route path="/parties/installments" element={<ComingSoon title="الأقساط" phase="المرحلة 5" />} />
        <Route path="/maintenance/tickets" element={<ComingSoon title="أوامر الصيانة" phase="المرحلة 6" />} />
        <Route path="/rental/fleet" element={<ComingSoon title="سجل المعدات" phase="المرحلة 6" />} />
        <Route path="/rental/contracts" element={<ComingSoon title="عقود الإيجار" phase="المرحلة 6" />} />
        <Route path="/logistics/trips" element={<ComingSoon title="النقلات" phase="المرحلة 6" />} />
        <Route path="/logistics/fleet" element={<ComingSoon title="الأسطول والسائقون" phase="المرحلة 6" />} />
        <Route path="/accounting/journal" element={<ComingSoon title="اليومية العامة" phase="المرحلة 4" />} />
        <Route path="/accounting/coa" element={<ComingSoon title="شجرة الحسابات" phase="المرحلة 4" />} />
        <Route path="/accounting/trial-balance" element={<ComingSoon title="ميزان المراجعة" phase="المرحلة 4" />} />
        <Route path="/accounting/vouchers" element={<ComingSoon title="سندات القبض والصرف" phase="المرحلة 4" />} />
        <Route path="/accounting/treasury" element={<ComingSoon title="الخزائن والبنوك" phase="المرحلة 4" />} />
        <Route path="/reports" element={<ComingSoon title="مركز التقارير" phase="المرحلة 5" />} />
        <Route path="/settings/printing" element={<ComingSoon title="إعدادات الطباعة" phase="المرحلة 2" />} />
        <Route path="/settings/backup" element={<ComingSoon title="النسخ الاحتياطي" phase="المرحلة 5" />} />
        <Route path="/settings/telegram" element={<ComingSoon title="بوت التليجرام" phase="المرحلة 5" />} />
        <Route path="/settings/appearance" element={<ComingSoon title="المظهر" phase="المرحلة 1" />} />
        <Route path="/settings/license" element={<ComingSoon title="الترخيص" phase="المرحلة 5" />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </MainLayout>
  )
}

export default function App() {
  const { theme, setup } = useAppStore()
  const seed = useDataStore((s) => s.seed)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // بذر البيانات الأولية (قسم عام + مخزن رئيسي) فور اكتمال المعالج
  useEffect(() => {
    if (setup.completed) seed(setup.features)
  }, [setup.completed, setup.features, seed])

  return (
    <HashRouter>
      {setup.completed ? <Shell /> : <FirstRunWizard />}
      <ToastHost />
    </HashRouter>
  )
}
