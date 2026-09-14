import { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useAppStore } from './stores/app.store.ts'
import { useDataStore } from './data/repo.ts'
import { evaluateLicense, activityMatches, isRevoked } from './core/license.ts'
import { lockReasonFor, isBackupDue } from './core/security.ts'
import { isDailySendDue, localNowIso } from './core/schedule.ts'
import { hasFeature } from './core/license.ts'
import { botConnected, sendDailyReportNow, sendBackupNow } from './ui/telegramSender.ts'
import { fetchAbout, fetchRevocationList, DEFAULT_CLOUD_BASE_URL } from './core/cloud.ts'
import { encryptForDevice } from './data/secureStorage.ts'
import { LockScreen } from './ui/LockScreen.tsx'
import { buildAccentCssVars } from './core/appearance.ts'
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
import { ChequesPage } from './ui/pages/ChequesPage.tsx'
import { EinvoicePage } from './ui/pages/EinvoicePage.tsx'
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
import { LabOrdersPage, LabTestsPage, LabPatientsPage, LabReferrersPage } from './ui/pages/LabPages.tsx'
import { ProjectsPage } from './ui/pages/ContractingPages.tsx'
import { ClinicPatientsPage, ClinicAppointmentsPage } from './ui/pages/ClinicPages.tsx'
import { CarsPage } from './ui/pages/CarsPage.tsx'
import { AboutPage } from './ui/pages/AboutPage.tsx'
import { MaintenancePage } from './ui/pages/MaintenancePage.tsx'
import { TransfersPage } from './ui/pages/TransfersPage.tsx'
import { AppearancePage } from './ui/pages/AppearancePage.tsx'
import { TelegramPage } from './ui/pages/TelegramPage.tsx'
import { AssetsPage } from './ui/pages/AssetsPage.tsx'
import { ToastHost } from './ui/components/ui.tsx'
import { NAV_SECTIONS } from './ui/navCatalog.tsx'

function usePageTitle(): string {
  const { pathname } = useLocation()
  for (const sec of NAV_SECTIONS) {
    const child = sec.children.find((c) => c.path === pathname)
    if (child) return sec.children.length === 1 ? sec.nameAr : `${sec.nameAr} — ${child.nameAr}`
  }
  return 'TAHAKAM ERP'
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
        <Route path="/inventory/transfers" element={<TransfersPage />} />
        <Route path="/inventory/counting" element={<StocktakePage />} />
        <Route path="/purchases/invoices" element={<PurchasesPage />} />
        <Route path="/purchases/returns" element={<PurchaseReturnsPage />} />
        <Route path="/parties/employees" element={<EmployeesPage />} />
        <Route path="/parties/installments" element={<InstallmentsPage />} />
        <Route path="/maintenance/tickets" element={<MaintenancePage />} />
        <Route path="/rental/fleet" element={<EquipmentPage />} />
        <Route path="/rental/contracts" element={<RentalContractsPage />} />
        <Route path="/lab/orders" element={<LabOrdersPage />} />
        <Route path="/lab/tests" element={<LabTestsPage />} />
        <Route path="/lab/patients" element={<LabPatientsPage />} />
        <Route path="/lab/referrers" element={<LabReferrersPage />} />
        <Route path="/contracting/projects" element={<ProjectsPage />} />
        <Route path="/clinic/patients" element={<ClinicPatientsPage />} />
        <Route path="/clinic/appointments" element={<ClinicAppointmentsPage />} />
        <Route path="/cars" element={<CarsPage />} />
        <Route path="/logistics/trips" element={<TripsPage />} />
        <Route path="/logistics/fleet" element={<FleetPage />} />
        <Route path="/accounting/journal" element={<JournalPage />} />
        <Route path="/accounting/coa" element={<CoaPage />} />
        <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
        <Route path="/accounting/vouchers" element={<VouchersPage />} />
        <Route path="/accounting/treasury" element={<TreasuryPage />} />
        <Route path="/accounting/cheques" element={<ChequesPage />} />
        <Route path="/accounting/assets" element={<AssetsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings/printing" element={<PrintSettingsPage />} />
        <Route path="/settings/backup" element={<BackupPage />} />
        <Route path="/settings/telegram" element={<TelegramPage />} />
        <Route path="/settings/appearance" element={<AppearancePage />} />
        <Route path="/settings/einvoice" element={<EinvoicePage />} />
        <Route path="/settings/license" element={<LicensePage />} />
        <Route path="/settings/about" element={<AboutPage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </MainLayout>
  )
}

export default function App() {
  const {
    theme, setup, touchLastSeen, appearance,
    activatedKey, activatedPayload, trialStartedAt, lastSeenAt, revokedKeys,
    setCloudData, lastHourlyBackupAt, setLastHourlyBackupAt,
  } = useAppStore()
  const seed = useDataStore((s) => s.seed)

  // ─── بوابة الترخيص (القرار 28): تقييم الحالة + الحرق + مطابقة النشاط ───
  const licenseState = useMemo(
    () => evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() }),
    [activatedPayload, trialStartedAt, lastSeenAt],
  )
  const lockReason = useMemo(
    () => lockReasonFor(licenseState, {
      revoked: activatedKey != null && isRevoked(activatedKey, revokedKeys),
      activityMismatch: activatedPayload != null && setup.completed && !activityMatches(activatedPayload, setup.activityId),
    }),
    [licenseState, activatedKey, revokedKeys, activatedPayload, setup.completed, setup.activityId],
  )

  // ─── مزامنة السحابة (Cloudflare): صفحة «حول» + قائمة الحرق — عند الإقلاع وكل 6 ساعات ───
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      const [about, revoked] = await Promise.all([
        fetchAbout(DEFAULT_CLOUD_BASE_URL),
        fetchRevocationList(DEFAULT_CLOUD_BASE_URL),
      ])
      if (cancelled) return
      // فشل الجلب (أوفلاين) لا يمس آخر بيانات محفوظة
      if (about !== null || revoked !== null) {
        setCloudData({ ...(about !== null ? { about } : {}), ...(revoked !== null ? { revoked } : {}) })
      }
    }
    sync()
    const t = setInterval(sync, 6 * 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [setCloudData])

  // ─── الإرسال المجدول عبر التليجرام (القرار 32): تقرير اليوم + نسخة — مرة يومياً بعد ساعة الجدولة ───
  useEffect(() => {
    if (!setup.completed) return
    const tick = async () => {
      const app = useAppStore.getState()
      // شروط الإرسال: الجدولة مفعلة + ميزة telegram_bot بالمفتاح + اتصال بوت سليم
      if (!app.schedule.enabled || !botConnected()) return
      const lic = evaluateLicense({
        activatedPayload: app.activatedPayload, trialStartedAt: app.trialStartedAt,
        lastSeenAt: app.lastSeenAt, today: new Date().toISOString(),
      })
      if (!hasFeature(lic, 'telegram_bot')) return
      const now = localNowIso()
      if (!isDailySendDue(app.lastDailySentDay, now, app.schedule.hour)) return
      try {
        if (app.telegram.sendDailyReport) await sendDailyReportNow()
        if (app.telegram.sendBackups) await sendBackupNow()
        // يُسجل اليوم فقط بعد نجاح الإرسال — الفشل (أوفلاين) يعيد المحاولة بالفحص التالي
        app.setLastDailySentDay(now.slice(0, 10))
      } catch { /* صامت — لا يعطل التطبيق، وسيعاد تلقائياً */ }
    }
    tick()
    const t = setInterval(tick, 5 * 60 * 1000) // فحص كل 5 دقائق
    return () => clearInterval(t)
  }, [setup.completed])

  // ─── النسخ الاحتياطي التلقائي كل ساعة (القرار 28): لقطة مشفرة على جهاز العميل ───
  useEffect(() => {
    if (!setup.completed) return
    const takeSnapshot = async () => {
      const now = new Date().toISOString()
      if (!isBackupDue(useAppStore.getState().lastHourlyBackupAt, now)) return
      try {
        const payload = JSON.stringify({ at: now, store: useDataStore.getState() })
        const encrypted = await encryptForDevice(payload)
        // حلقة من 3 خانات: الأقدم يُستبدل تلقائياً
        const slot = (Date.parse(now) / (60 * 60 * 1000)) % 3 | 0
        localStorage.setItem(`shopsys-hourly-${slot}`, encrypted)
        setLastHourlyBackupAt(now)
      } catch { /* لا يعطل التطبيق أبداً */ }
    }
    takeSnapshot()
    const t = setInterval(takeSnapshot, 5 * 60 * 1000) // فحص كل 5 دقائق، لقطة كل ساعة
    return () => clearInterval(t)
  }, [setup.completed, lastHourlyBackupAt, setLastHourlyBackupAt])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // تطبيق المظهر: اللون الرئيسي كمتغيرات CSS + التكبير + تقليل الحركة
  useEffect(() => {
    const root = document.documentElement
    for (const [k, v] of Object.entries(buildAccentCssVars(appearance.accentId))) root.style.setProperty(k, v)
    ;(root.style as CSSStyleDeclaration & { zoom?: string }).zoom = appearance.zoom === 1 ? '' : String(appearance.zoom)
    root.classList.toggle('reduce-motion', appearance.reduceMotion)
  }, [appearance])

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

  // القفل (القرار 28): بعد اكتمال الإعداد، أي حالة غير سارية ⇒ الشاشة المقفلة فقط
  if (setup.completed && lockReason) {
    return (
      <>
        <LockScreen reason={lockReason} state={licenseState} />
        <ToastHost />
      </>
    )
  }

  return (
    <HashRouter>
      {setup.completed ? <Shell /> : <FirstRunWizard />}
      <ToastHost />
    </HashRouter>
  )
}
