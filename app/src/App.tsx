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
import { PurchasesPage } from './ui/pages/PurchasesPage.tsx'
import { PurchaseReturnsPage } from './ui/pages/PurchaseReturnsPage.tsx'
import { StocktakePage } from './ui/pages/StocktakePage.tsx'
import { PosPage } from './ui/pages/PosPage.tsx'
import { SalesInvoicesPage } from './ui/pages/SalesInvoicesPage.tsx'
import { SaleReturnsPage } from './ui/pages/SaleReturnsPage.tsx'
import { ShiftsPage } from './ui/pages/ShiftsPage.tsx'
import { JournalPage } from './ui/pages/JournalPage.tsx'
import { CoaPage } from './ui/pages/CoaPage.tsx'
import { TrialBalancePage } from './ui/pages/TrialBalancePage.tsx'
import { VouchersPage } from './ui/pages/VouchersPage.tsx'
import { TreasuryPage } from './ui/pages/TreasuryPage.tsx'
import { GeneralSettingsPage } from './ui/pages/GeneralSettingsPage.tsx'
import { PrintSettingsPage } from './ui/pages/PrintSettingsPage.tsx'
import { EmployeesPage } from './ui/pages/EmployeesPage.tsx'
import { InstallmentsPage } from './ui/pages/InstallmentsPage.tsx'
import { ReportsPage } from './ui/pages/ReportsPage.tsx'
import { LicensePage } from './ui/pages/LicensePage.tsx'
import { BackupPage } from './ui/pages/BackupPage.tsx'
import { TripsPage } from './ui/pages/TripsPage.tsx'
import { FleetPage } from './ui/pages/FleetPage.tsx'
import { EquipmentPage } from './ui/pages/EquipmentPage.tsx'
import { RentalContractsPage } from './ui/pages/RentalContractsPage.tsx'
import { MaintenancePage } from './ui/pages/MaintenancePage.tsx'
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
        <Route path="/pos" element={<PosPage />} />
        <Route path="/sales/invoices" element={<SalesInvoicesPage />} />
        <Route path="/sales/returns" element={<SaleReturnsPage />} />
        <Route path="/sales/shifts" element={<ShiftsPage />} />
        <Route path="/inventory/transfers" element={<ComingSoon title="التحويلات المخزنية" phase="المرحلة 3" />} />
        <Route path="/inventory/counting" element={<StocktakePage />} />
        <Route path="/purchases/invoices" element={<PurchasesPage />} />
        <Route path="/purchases/returns" element={<PurchaseReturnsPage />} />
        <Route path="/parties/employees" element={<EmployeesPage />} />
        <Route path="/parties/installments" element={<InstallmentsPage />} />
        <Route path="/maintenance/tickets" element={<MaintenancePage />} />
        <Route path="/rental/fleet" element={<EquipmentPage />} />
        <Route path="/rental/contracts" element={<RentalContractsPage />} />
        <Route path="/logistics/trips" element={<TripsPage />} />
        <Route path="/logistics/fleet" element={<FleetPage />} />
        <Route path="/accounting/journal" element={<JournalPage />} />
        <Route path="/accounting/coa" element={<CoaPage />} />
        <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
        <Route path="/accounting/vouchers" element={<VouchersPage />} />
        <Route path="/accounting/treasury" element={<TreasuryPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings/printing" element={<PrintSettingsPage />} />
        <Route path="/settings/backup" element={<BackupPage />} />
        <Route path="/settings/telegram" element={<ComingSoon title="بوت التليجرام" phase="المرحلة 5" />} />
        <Route path="/settings/appearance" element={<ComingSoon title="المظهر" phase="المرحلة 1" />} />
        <Route path="/settings/license" element={<LicensePage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </MainLayout>
  )
}

export default function App() {
  const { theme, setup, touchLastSeen } = useAppStore()
  const seed = useDataStore((s) => s.seed)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // مرساة «آخر ظهور» ضد إرجاع ساعة الجهاز (نظام الترخيص) — عند الإقلاع وكل ساعة
  useEffect(() => {
    touchLastSeen()
    const t = setInterval(touchLastSeen, 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [touchLastSeen])

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
