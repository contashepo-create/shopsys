import { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useAppStore } from './stores/app.store.ts'
import { useDataStore } from './data/repo.ts'
import { evaluateLicense, oldestValidDay, newestValidDay } from './core/license.ts'
import { currentLockReason, isBackupDue } from './core/security.ts'
import { isDailySendDue, localNowIso } from './core/schedule.ts'
import { runSyncCycle, watchLocalChanges } from './data/syncRunner.ts'
import { hasFeature } from './core/license.ts'
import { botConnected, sendDailyReportNow, sendBackupNow } from './ui/telegramSender.ts'
import { fetchAbout, fetchAccountMessage, fetchRevocationList, mergeRevocationLists, fetchCloudNotices, LICENSE_CLOUD_BASE_URL, APP_SERVICES_CLOUD_BASE_URL } from './core/cloud.ts'
import { fetchDeviceFlags, effectiveFeatures } from './core/featureFlags.ts'
/* بند 2 (تدقيق 2026-10-08): بلاغ التسجيل الجديد يصل المطوّر عبر مركز التحكم */
import { buildRegistrationReport, shouldReportRegistration, sendRegistrationReport } from './core/registration.ts'
import { ACTIVITY_TEMPLATES } from './core/activities.ts'
import { encryptForDevice } from './data/secureStorage.ts'
import { DesktopKeyRecoveryImport } from './ui/components/DesktopKeyRecovery.tsx'
import { isElectronRuntime, desktopDatabaseStorage } from './data/desktopBridge.ts'
import { desktopStorageFailure } from './data/persistentStorage.ts'
import { LockScreen } from './ui/LockScreen.tsx'
import { DevNoticeHost } from './ui/components/DevNoticeModal.tsx'
import { LoginScreen } from './ui/LoginScreen.tsx'
import { authRequired } from './core/auth.ts'
import { buildAccentCssVars } from './core/appearance.ts'
import { decideTabLock, parseTabLock, TAB_HEARTBEAT_MS } from './core/concurrency.ts'
import { effectivePermissionsFor, rolesWithOverrides, canAccessPath, permissionForPath, PERMISSIONS } from './core/permissions.ts'
import { pathAllowedForSetup } from './core/coaVisibility.ts'
import { labelFor } from './core/activityLabels.ts'
import { useState } from 'react'
import { FirstRunWizard } from './ui/setup/FirstRunWizard.tsx'
import { LegalGate, LegalPage } from './ui/LegalGate.tsx'
import { LEGAL_VERSION } from './core/legal.ts'
import { MainLayout } from './ui/layout/MainLayout.tsx'
import { Dashboard } from './ui/pages/Dashboard.tsx'
import { PermissionsPage } from './ui/pages/PermissionsPage.tsx'
import { ItemsPage } from './ui/pages/ItemsPage.tsx'
import { WarehousesPage } from './ui/pages/WarehousesPage.tsx'
import { BranchesPage } from './ui/pages/BranchesPage.tsx'
import { CustomersPage, SuppliersPage } from './ui/pages/PartiesPages.tsx'
import { PurchasesPage } from './ui/pages/PurchasesPage.tsx'

import { PurchaseReturnsPage } from './ui/pages/PurchaseReturnsPage.tsx'
import { PurchaseOrdersPage } from './ui/pages/PurchaseOrdersPage.tsx'
import { ApprovalsPage as DocApprovalsPage } from './ui/pages/ApprovalsPage.tsx'
import { StocktakePage } from './ui/pages/StocktakePage.tsx'
import { RecipesPage } from './ui/pages/RecipesPage.tsx'
import { ProcessingPage } from './ui/pages/ProcessingPage.tsx'
import { JewelryPage } from './ui/pages/JewelryPage.tsx'
import { PriceListsPage } from './ui/pages/PriceListsPage.tsx'
import { PromotionsPage } from './ui/pages/PromotionsPage.tsx'
import { PosPage } from './ui/pages/PosPage.tsx'
import { SalesInvoicesPage } from './ui/pages/SalesInvoicesPage.tsx'
import { InvoiceDocumentRoute } from './ui/pages/InvoiceDocumentRoute.tsx'
import { ContractingInvoicesPage } from './ui/pages/ContractingInvoicesPage.tsx'
import { SaleReturnsPage } from './ui/pages/SaleReturnsPage.tsx'
import { ShiftsPage } from './ui/pages/ShiftsPage.tsx'
import { JournalPage } from './ui/pages/JournalPage.tsx'
import { CoaPage } from './ui/pages/CoaPage.tsx'
import { TrialBalancePage } from './ui/pages/TrialBalancePage.tsx'
import { VouchersPage } from './ui/pages/VouchersPage.tsx'
import { TreasuryPage } from './ui/pages/TreasuryPage.tsx'
import { PaymentTerminalsPage } from './ui/pages/PaymentTerminalsPage.tsx'
import { ChequesPage } from './ui/pages/ChequesPage.tsx'
import { EinvoicePage } from './ui/pages/EinvoicePage.tsx'
import { GeneralSettingsPage } from './ui/pages/GeneralSettingsPage.tsx'
import { LanSettingsPage } from './ui/pages/LanSettingsPage.tsx'
import { startHostSession, stopHostSession, useLanStatusStore } from './data/lan/hostSession.ts'
import { bootRemoteSession, disconnectRemoteSession } from './data/lan/remoteSession.ts'
import { CostCentersPage } from './ui/pages/CostCentersPage.tsx'
import { PrintSettingsPage } from './ui/pages/PrintSettingsPage.tsx'
import { EmployeesPage } from './ui/pages/EmployeesPage.tsx'
import { HrPage } from './ui/pages/HrPage.tsx'
import { InstallmentsPage } from './ui/pages/InstallmentsPage.tsx'
import { ReportsPage } from './ui/pages/ReportsPage.tsx'
import { NasqPage } from './ui/pages/NasqPage.tsx'
import { StatementsPage } from './ui/pages/StatementsPage.tsx'
import { LicensePage } from './ui/pages/LicensePage.tsx'
import { BackupPage } from './ui/pages/BackupPage.tsx'
import { TripsPage } from './ui/pages/TripsPage.tsx'
import { FleetPage } from './ui/pages/FleetPage.tsx'
import { EquipmentPage } from './ui/pages/EquipmentPage.tsx'
import { RentalContractsPage } from './ui/pages/RentalContractsPage.tsx'
import { LabOrdersPage, LabTestsPage, LabPatientsPage, LabReferrersPage } from './ui/pages/LabPages.tsx'
import { ProjectsPage } from './ui/pages/ContractingPages.tsx'
import { ContractingReportsPage } from './ui/pages/ContractingReportsPage.tsx'
import { EquipmentReportsPage } from './ui/pages/EquipmentReportsPage.tsx'
import { RestaurantReportsPage } from './ui/pages/RestaurantReportsPage.tsx'
import { QuotationsPage } from './ui/pages/QuotationsPage.tsx'
import { BoqPage, SubcontractorsPage, BondsPage, DailyWorkersPage } from './ui/pages/ContractingDepthPages.tsx'
import { MaterialIssuesPage, ClientCollectionsPage, EvmDashboardPage, ApprovalsPage } from './ui/pages/ProjectOpsPages.tsx'
import { ProjectBudgetPage, ProjectTasksPage } from './ui/pages/ContractingPlanPages.tsx'
import { PropertiesPage, LeasesPage } from './ui/pages/RealEstatePages.tsx'
import { LogisticsInvoicesPage, RentalInvoicesPage, RealestateInvoicesPage } from './ui/pages/ActivityInvoicesHubs.tsx'
import { CustodyPage } from './ui/pages/CustodyPage.tsx'
import { SyncPage } from './ui/pages/SyncPage.tsx'
import { ClinicPatientsPage, ClinicAppointmentsPage } from './ui/pages/ClinicPages.tsx'
import { CarsPage } from './ui/pages/CarsPage.tsx'
import { AboutPage } from './ui/pages/AboutPage.tsx'
import { ProfilePage } from './ui/pages/ProfilePage.tsx'
import { AuditLogPage } from './ui/pages/AuditLogPage.tsx'
import { IssuesPage } from './ui/pages/IssuesPage.tsx'
import { SupportPage } from './ui/pages/SupportPage.tsx'
import { GuidesPage } from './ui/pages/GuidesPage.tsx'
import { WalletServicesPage } from './ui/pages/WalletServicesPage.tsx'
import { WastagePage } from './ui/pages/WastagePage.tsx'
import { ConsumptionPage } from './ui/pages/ConsumptionPage.tsx'
import { BarcodeCenterPage } from './ui/pages/BarcodeCenterPage.tsx'
import { ScaleSettingsPage } from './ui/pages/ScaleSettingsPage.tsx'
import { OpeningBalancesPage } from './ui/pages/OpeningBalancesPage.tsx'
import { SerialsPage } from './ui/pages/SerialsPage.tsx'
import { SettlementsPage } from './ui/pages/SettlementsPage.tsx'
import { ExchangePage } from './ui/pages/ExchangePage.tsx'
import { RestaurantOrdersPage } from './ui/pages/RestaurantOrdersPage.tsx'
import { installErrorHooks, logEvent } from './core/applog.ts'
import { MaintenancePage } from './ui/pages/MaintenancePage.tsx'
import { LaundryPage } from './ui/pages/LaundryPage.tsx'
import { BookingsPage } from './ui/pages/BookingsPage.tsx'
import { TransfersPage } from './ui/pages/TransfersPage.tsx'
import { AppearancePage } from './ui/pages/AppearancePage.tsx'
import { TelegramPage } from './ui/pages/TelegramPage.tsx'
import { AssetsPage } from './ui/pages/AssetsPage.tsx'
import { ExternalCommissionsPage } from './ui/pages/ExternalCommissionsPage.tsx'
import { ToastHost, useToast } from './ui/components/ui.tsx'
import { ThermalPreview } from './ui/components/ThermalPreview.tsx'
import { KeyboardNavigation } from './ui/components/KeyboardNavigation.tsx'
import { NAV_SECTIONS } from './ui/navCatalog.tsx'

function usePageTitle(): string {
  const { pathname } = useLocation()
  const activityId = useAppStore((s) => s.setup.activityId)
  for (const sec of NAV_SECTIONS) {
    const child = sec.children.find((c) => c.path === pathname)
    if (child) {
      // مسميات حسب النشاط (أمر المالك) — العنوان يطابق اسم الفرع في القائمة
      const secName = labelFor(activityId, sec.id, sec.nameAr)
      const childName = labelFor(activityId, `${sec.id}.${child.id}`, child.nameAr)
      return sec.children.length === 1 ? secName : `${secName} — ${childName}`
    }
  }
  return 'TAHAKAM ERP'
}

function Shell() {
  const title = usePageTitle()
  const location = useLocation()

  // ─── بوابة تسجيل الدخول (سد ثغرة انتحال الصلاحيات): PIN إجباري متى فُعّلت المصادقة ───
  const { appUsers, currentUserId, roleOverrides, customRoles, ownerPinHash, loggedOut } = useDataStore()
  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  // بوابة الدخول + إصلاح باج «إجبار تغيير الرقم أول دخول»: login() كان يرفع loggedOut
  // فتختفي شاشة الدخول قبل ظهور مودال التغيير الإجباري — الآن من عليه mustChangePin
  // يبقى محتجزاً في LoginScreen (بمودالها الإجباري) حتى يعيّن رقمه الخاص
  if (authRequired(ownerPinHash, appUsers.filter((u) => u.active).length) && (loggedOut || activeUser?.mustChangePin)) {
    return <LoginScreen />
  }
  // ─── حراسة الوحدات (سد ثغرة الرابط المباشر): شاشة وحدة غير مفعلة للنشاط ───
  // لا تُفتح حتى بكتابة المسار يدوياً — القائمة تخفيها والحارس يمنعها (دفاع مزدوج)
  const setupState = useAppStore.getState().setup
  if (!pathAllowedForSetup(location.pathname, setupState.modules, setupState.features, setupState.activityId)) {
    return (
      <MainLayout title="غير متاح لنشاطك">
        <div className="max-w-lg mx-auto mt-16 text-center space-y-4 p-10 rounded-3xl bg-white dark:bg-card-dark border border-amber-500/25 anim-pop">
          <div className="text-5xl">🔒</div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white">هذه الشاشة غير مفعلة لنشاطك</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            هذا القسم يخص وحدة عمل غير مفعلة في نشاطك الحالي.
            تفعيل الأقسام الإضافية يتم عبر المطوّر بمفتاح موقّع.
          </p>
        </div>
      </MainLayout>
    )
  }
  const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, setupState.activityId))
  if (!canAccessPath(location.pathname, perms)) {
    const needed = permissionForPath(location.pathname)
    const permName = PERMISSIONS.find((p) => p.id === needed)?.nameAr ?? needed
    return (
      <MainLayout title="غير مصرح">
        <div className="max-w-lg mx-auto mt-16 text-center space-y-4 p-10 rounded-3xl bg-white dark:bg-card-dark border border-rose-500/25 anim-pop">
          <div className="text-5xl">🚫</div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white">هذه الشاشة تحتاج صلاحية</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            حسابك «{activeUser?.nameAr ?? 'الحالي'}» لا يملك صلاحية «{permName}».
            اطلب من المالك منحها لدورك أو لحسابك من شاشة الصلاحيات.
          </p>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout title={title}>
      <KeyboardNavigation />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings/permissions" element={<PermissionsPage />} />
        <Route path="/settings/general" element={<GeneralSettingsPage />} />
        <Route path="/settings/lan" element={<LanSettingsPage />} />
        <Route path="/settings/cost-centers" element={<CostCentersPage />} />
        <Route path="/inventory/items" element={<ItemsPage />} />
        <Route path="/inventory/warehouses" element={<WarehousesPage />} />
        <Route path="/parties/customers" element={<CustomersPage />} />
        <Route path="/purchases/suppliers" element={<SuppliersPage />} />
        {/* شاشات المراحل القادمة — كلها مسجلة في الراوتر منذ الآن */}
        <Route path="/pos" element={<PosPage />} />
        <Route path="/sales/invoices" element={<SalesInvoicesPage />} />
        <Route path="/sales/invoices/new" element={<InvoiceDocumentRoute kind="sale" />} />
        <Route path="/sales/returns" element={<SaleReturnsPage />} />
        <Route path="/sales/shifts" element={<ShiftsPage />} />
        <Route path="/sales/price-lists" element={<PriceListsPage />} />
        <Route path="/sales/promotions" element={<PromotionsPage />} />
        <Route path="/inventory/transfers" element={<TransfersPage />} />
        <Route path="/inventory/counting" element={<StocktakePage />} />
        <Route path="/inventory/recipes" element={<RecipesPage />} />
        <Route path="/inventory/processing" element={<ProcessingPage />} />
        <Route path="/inventory/jewelry" element={<JewelryPage />} />
        <Route path="/purchases/invoices" element={<PurchasesPage />} />
        <Route path="/purchases/invoices/new" element={<InvoiceDocumentRoute kind="purchase" />} />
        <Route path="/purchases/orders" element={<PurchaseOrdersPage />} />
        <Route path="/settings/approvals" element={<DocApprovalsPage />} />
        <Route path="/purchases/returns" element={<PurchaseReturnsPage />} />
        <Route path="/parties/employees" element={<EmployeesPage />} />
        <Route path="/parties/payroll" element={<EmployeesPage initialTab="payroll" />} />
        <Route path="/parties/employee-advances" element={<EmployeesPage initialTab="advances" />} />
        <Route path="/parties/employee-deductions" element={<EmployeesPage initialTab="deductions" />} />
        <Route path="/parties/employee-commissions" element={<EmployeesPage initialTab="commissions" />} />
    {/* شؤون الموظفين — قسم مستقل بتابات داخلية (حضور/بصمة/إجازات/ورديات/تقارير).
        مسار واحد ديناميكي يغطي كل التابات: المسارات الصريحة المكررة كانت تطابَق
        قبله فلا يصل :tab إلى useParams إطلاقاً — فتبقى الصفحة على «الحضور»
        مهما نقر المستخدم من التابات (عطل المالك: «التابات لا تعمل»). */}
    <Route path="/hr" element={<HrPage />} />
    <Route path="/hr/:tab" element={<HrPage />} />
        <Route path="/parties/installments" element={<InstallmentsPage />} />
        <Route path="/maintenance/tickets" element={<MaintenancePage />} />
        <Route path="/laundry/orders" element={<LaundryPage />} />
        <Route path="/bookings" element={<BookingsPage />} />
        <Route path="/rental/fleet" element={<EquipmentPage />} />
        <Route path="/rental/invoices" element={<RentalInvoicesPage />} />
        <Route path="/rental/contracts" element={<RentalContractsPage />} />
        <Route path="/lab/orders" element={<LabOrdersPage />} />
        <Route path="/lab/tests" element={<LabTestsPage />} />
        <Route path="/lab/patients" element={<LabPatientsPage />} />
        <Route path="/lab/referrers" element={<LabReferrersPage />} />
        <Route path="/contracting/invoices" element={<ContractingInvoicesPage />} />
      <Route path="/contracting/projects" element={<ProjectsPage />} />
        <Route path="/contracting/quotations" element={<QuotationsPage />} />
        <Route path="/contracting/boq" element={<BoqPage />} />
        <Route path="/contracting/subcontractors" element={<SubcontractorsPage />} />
        <Route path="/contracting/bonds" element={<BondsPage />} />
        <Route path="/contracting/daily-workers" element={<DailyWorkersPage />} />
        <Route path="/contracting/material-issues" element={<MaterialIssuesPage />} />
        <Route path="/contracting/collections" element={<ClientCollectionsPage />} />
        <Route path="/contracting/evm" element={<EvmDashboardPage />} />
        <Route path="/contracting/reports" element={<ContractingReportsPage />} />
        <Route path="/rental/reports" element={<EquipmentReportsPage />} />
        <Route path="/restaurant/reports" element={<RestaurantReportsPage />} />
        <Route path="/realestate/properties" element={<PropertiesPage />} />
        <Route path="/realestate/leases" element={<LeasesPage />} />
        <Route path="/realestate/invoices" element={<RealestateInvoicesPage />} />
        <Route path="/contracting/budget" element={<ProjectBudgetPage />} />
        <Route path="/contracting/tasks" element={<ProjectTasksPage />} />
        <Route path="/contracting/approvals" element={<ApprovalsPage />} />
        <Route path="/parties/custody" element={<CustodyPage />} />
        <Route path="/clinic/patients" element={<ClinicPatientsPage />} />
        <Route path="/clinic/appointments" element={<ClinicAppointmentsPage />} />
        <Route path="/cars" element={<CarsPage />} />
        <Route path="/logistics/trips" element={<TripsPage />} />
        <Route path="/logistics/invoices" element={<LogisticsInvoicesPage />} />
        <Route path="/logistics/fleet" element={<FleetPage />} />
        <Route path="/accounting/journal" element={<JournalPage />} />
        <Route path="/accounting/coa" element={<CoaPage />} />
        <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
        <Route path="/accounting/vouchers" element={<VouchersPage />} />
        <Route path="/accounting/treasury" element={<TreasuryPage />} />
        <Route path="/accounting/payment-terminals" element={<PaymentTerminalsPage />} />
        <Route path="/accounting/cheques" element={<ChequesPage />} />
        <Route path="/accounting/assets" element={<AssetsPage />} />
        <Route path="/accounting/external-commissions" element={<ExternalCommissionsPage />} />
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/nasq" element={<NasqPage />} />
        <Route path="/reports/statements" element={<StatementsPage />} />
        <Route path="/settings/printing" element={<PrintSettingsPage />} />
        <Route path="/settings/backup" element={<BackupPage />} />
        <Route path="/settings/sync" element={<SyncPage />} />
        <Route path="/settings/telegram" element={<TelegramPage />} />
        <Route path="/settings/appearance" element={<AppearancePage />} />
        <Route path="/settings/einvoice" element={<EinvoicePage />} />
        <Route path="/settings/license" element={<LicensePage />} />
        <Route path="/settings/legal" element={<LegalPage />} />
        <Route path="/settings/profile" element={<ProfilePage />} />
        <Route path="/settings/about" element={<AboutPage />} />
        <Route path="/settings/audit" element={<AuditLogPage />} />
        <Route path="/settings/issues" element={<IssuesPage />} />
        <Route path="/settings/support" element={<SupportPage />} />
        <Route path="/settings/guides" element={<GuidesPage />} />
        <Route path="/wallets/ops" element={<WalletServicesPage />} />
        <Route path="/inventory/wastage" element={<WastagePage />} />
        <Route path="/inventory/consumption" element={<ConsumptionPage />} />
        <Route path="/inventory/barcode-center" element={<BarcodeCenterPage />} />
        <Route path="/inventory/scale" element={<ScaleSettingsPage />} />
        <Route path="/accounting/opening-balances" element={<OpeningBalancesPage />} />
        <Route path="/inventory/serials" element={<SerialsPage />} />
        <Route path="/accounting/settlements" element={<SettlementsPage />} />
        <Route path="/sales/exchange" element={<ExchangePage />} />
        <Route path="/sales/restaurant-orders" element={<RestaurantOrdersPage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </MainLayout>
  )
}

/** شاشة استرداد: تظهر حين تعذّر قراءة البيانات — لا معالج إعداد ولا كتابة فوق البيانات */
function DataRecoveryScreen({ reason }: { reason: string }) {
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-slate-100 dark:bg-slate-950">
      <div className="max-w-lg space-y-4 p-8 rounded-3xl bg-white dark:bg-card-dark border border-rose-500/30 shadow-2xl">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-black text-slate-800 dark:text-white">تعذّر فتح بياناتك — لم يبدأ إعداد جديد</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          بياناتك لم تُحذف ولم يُكتب فوقها. هذا الخطأ يعني أن التطبيق لم يستطع قراءة قاعدة البيانات المحفوظة،
          فأوقف الحفظ حمايةً لها. تأكد من توصيل قرص مكان البيانات، ثم أعد المحاولة. إن استمر الخطأ أرسل ملف السجل للدعم.
        </p>
        <p dir="ltr" className="text-[11px] font-mono text-rose-600 dark:text-rose-400 break-all">{reason}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
        >
          🔄 إعادة المحاولة
        </button>
        {/* v1.0.22: فقدان المفتاح لا يعني فقدان البيانات — استرداده من ملف مفتاح الاسترداد */}
        <DesktopKeyRecoveryImport />
      </div>
    </div>
  )
}

/** معرف هذا التبويب — ثابت طوال حياته */
const TAB_ID = `tab-${Math.random().toString(36).slice(2, 10)}`
const TAB_LOCK_KEY = 'shopsys-tab-lock'

export default function App() {
  /* §101 التنفيذية: بوابة ترطيب المتجرين — داخل Electron فقط (القراءة من
     SQLite عبر IPC غير متزامنة، فبدون البوابة يومض معالج التثبيت أول كل
     إقلاع). في المتصفح الترطيب متزامن فلا بوابة أصلاً — سلوك الويب
     والاختبارات كما هو حرفياً. */
  const needsHydrationGate = isElectronRuntime()
  const [storesHydrated, setStoresHydrated] = useState(() => {
    if (!needsHydrationGate) return true
    try { return useAppStore.persist.hasHydrated() && useDataStore.persist.hasHydrated() } catch { return true }
  })
  /* v1.0.19: فشل قراءة القاعدة ≠ «عميل جديد». كان المؤقت القديم (5 ثوانٍ) يفتح البوابة
     بحالة افتراضية فيظهر معالج الإعداد وكأن البيانات اختفت. الآن: لا فتح بلا ترطيب
     حقيقي، وفشل القراءة يعرض شاشة استرداد بدل المعالج (والكتابة ممنوعة). */
  const [hydrationFailure, setHydrationFailure] = useState<string | null>(null)
  useEffect(() => {
    if (storesHydrated) return
    const check = () => {
      const failure = desktopStorageFailure()
      if (failure) { setHydrationFailure(failure); return }
      try { if (useAppStore.persist.hasHydrated() && useDataStore.persist.hasHydrated()) setStoresHydrated(true) } catch { setStoresHydrated(true) }
    }
    const offApp = useAppStore.persist.onFinishHydration(check)
    const offData = useDataStore.persist.onFinishHydration(check)
    check()
    const poll = setInterval(check, 500) /* فشل الترطيب لا يُطلق onFinishHydration */
    return () => { offApp(); offData(); clearInterval(poll) }
  }, [storesHydrated])

  const {
    theme, setup, touchLastSeen, appearance,
    /* إصدار الوثيقة تغيّر (2026-10-08: إفصاح بلاغ التسجيل) ⇒ الموافقة القديمة لا
       تكفي، فتُطلب من جديد — وهذا ما كان معلناً في المتجر («تطلب مجدداً عند
       التحديث») ولم يكن منفذاً: كان الفحص `!legal` فقط. */
    legal: legalCurrent,
    activatedKey, activatedPayload, trialStartedAt, lastSeenAt, revokedKeys, deviceFlags,
    setCloudData, lastHourlyBackupAt, setLastHourlyBackupAt, licenseAudit,
  } = useAppStore()
  /* الموافقة سارية فقط على الإصدار الحالي من الوثيقة — فأي تغيير جوهري في
     الاتفاقية/الخصوصية يعيد بوابة الموافقة مرة واحدة بعد التحديث. */
  const legal = legalCurrent && legalCurrent.version === LEGAL_VERSION ? legalCurrent : null
  /* لا يُرسل أي شيء يحمل معرّف الجهاز قبل قبول الإصدار الحالي من الاتفاقية — وإلا
     فالمحدَّث الذي لم يوافق بعد على الإفصاح الجديد يرسل بياناته قبل موافقته. */
  const legalAccepted = legal !== null
  const seed = useDataStore((s) => s.seed)

  /* v1.0.8: مرساة التجربة خارج القاعدة (سطح المكتب) — مسح البيانات لا يعيد
     التجربة: عند الإقلاع نطابق بداية التجربة مع أقدم تاريخ معروف للجهاز */
  /* ح1/ح5 (مراجعة ③): مطابقة مرساة سطح المكتب — الأقدم لبداية التجربة، والأحدث لآخر
     ظهور، والقيم التالفة لا تُقبل. تُستدعى عند الإقلاع وكل ساعة من مؤقت «آخر ظهور». */
  const syncDesktopAnchor = (): void => {
    if (typeof window === 'undefined' || typeof window.shopsysTrialAnchor !== 'function') return
    const before = useAppStore.getState()
    void window.shopsysTrialAnchor({ firstTrialAt: before.trialStartedAt, lastSeenAt: before.lastSeenAt }).then((anchor) => {
      const cur = useAppStore.getState()
      const trialStartedAt = oldestValidDay(cur.trialStartedAt, anchor.firstTrialAt) ?? cur.trialStartedAt
      const lastSeenAt = newestValidDay(cur.lastSeenAt, anchor.lastSeenAt) ?? cur.lastSeenAt
      if (trialStartedAt !== cur.trialStartedAt || lastSeenAt !== cur.lastSeenAt) useAppStore.setState({ trialStartedAt, lastSeenAt })
    }).catch(() => { /* المرساة مساعدة — لا تعطل الإقلاع */ })
  }

  /* v1.0.9 (درع البيانات): إشعار استرداد القاعدة — إن اكتُشف تلف عند الإقلاع
     استُردت أحدث نسخة سليمة تلقائياً (أو بدئت قاعدة جديدة لعدم وجود نسخة) */
  useEffect(() => {
    const bridge = desktopDatabaseStorage()
    if (!bridge?.recoveryNotice) return
    void bridge.recoveryNotice().then((notice) => {
      if (!notice) return
      const toast = useToast.getState()
      if (notice.from) toast.show('اكتُشف تلف في قاعدة البيانات واستُردت تلقائياً من أحدث نسخة سليمة ✓')
      else toast.show('تعذّر إيجاد نسخة سليمة — بدئت قاعدة جديدة. استعد بياناتك من «النسخ الاحتياطي ← استعادة نسخة قاعدة كاملة»', 'error')
    }).catch(() => { /* إشعار مساعد — لا يعطل الإقلاع */ })
  }, [])

  // ─── بوابة الترخيص (القرار 28): تقييم الحالة + الحرق + مطابقة النشاط ───
  /* ث1 (تدقيق 2026-10-08): إعادة التحقق من توقيع المفتاح المحفوظ في كل إقلاع.
     الحمولة تُشتق من المفتاح الموقّع لا من التخزين — تعديل `activatedPayload`
     في localStorage (نسخة الويب نص صريح) لم يعد يفتح `lifetime` بكل الميزات. */
  useEffect(() => {
    if (!storesHydrated) return
    void useAppStore.getState().reverifyActivation()
  }, [storesHydrated])

  const licenseState = useMemo(
    () => evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString(), deviceFlags }),
    [activatedPayload, trialStartedAt, lastSeenAt, deviceFlags],
  )
  const lockReason = useMemo(
    () => currentLockReason(licenseState, { activatedKey, activatedPayload, revokedKeys, licenseAudit, setup }),
    [licenseState, activatedKey, activatedPayload, revokedKeys, licenseAudit, setup],
  )

  // ─── قفل الكاتب الواحد (البند 4): تبويب ثانٍ على نفس القاعدة = قراءة فقط ───
  const [readOnlyTab, setReadOnlyTab] = useState(false)
  // ─── حارس اقتراحات المتصفح (بلاغ المالك: «القوائم تقترح نصوصاً محفوظة») ───
  // كل input بلا autocomplete صريح يُختم off تلقائياً — التطبيق مكتبي داخلي،
  // اقتراحات المتصفح المحفوظة تشوش الكاشير وقد تكشف مدخلات مستخدم سابق.
  useEffect(() => {
    const stamp = (root: ParentNode) => {
      root.querySelectorAll<HTMLInputElement>('input:not([autocomplete])').forEach((el) => {
        el.setAttribute('autocomplete', 'off')
      })
    }
    stamp(document)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => { if (n instanceof HTMLElement) stamp(n) })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    const beat = () => {
      /* v1.0.19: في سطح المكتب الكاتب الوحيد محمي أصلاً بقفل العملية الواحدة
         (requestSingleInstanceLock). نبضة تركها تطبيق سابق قُتل أثناء التحديث أو
         إعادة التشغيل كانت تُظهر «التطبيق مفتوح في نافذة أخرى» بلا سبب. */
      const existing = isElectronRuntime() ? null : parseTabLock(localStorage.getItem(TAB_LOCK_KEY))
      const d = decideTabLock(existing, TAB_ID, Date.now())
      if (d.kind === 'read_only') { setReadOnlyTab(true); return }
      // acquired أو takeover: نكتب نبضتنا ونستمر كاتباً وحيداً
      localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId: TAB_ID, heartbeatAt: Date.now() }))
      setReadOnlyTab(false)
    }
    beat()
    const t = setInterval(beat, TAB_HEARTBEAT_MS)
    const release = () => {
      const existing = parseTabLock(localStorage.getItem(TAB_LOCK_KEY))
      if (existing?.tabId === TAB_ID) localStorage.removeItem(TAB_LOCK_KEY)
    }
    window.addEventListener('beforeunload', release)
    return () => { clearInterval(t); release(); window.removeEventListener('beforeunload', release) }
  }, [])

  // ─── شبكة المحل (§102): إقلاع دور الجهاز — مضيف مفعّل يفتح خادمه، وعميل
  // مفعل يعيد الاتصال بالمضيف تلقائياً بالتوكن المحفوظ (بلا رمز اقتران) ───
  /* ح7 (مراجعة ③): شبكة المحل لا تعمل خلف شاشة القفل ولا لغير المرخّص. المضيف يتطلب
     ميزة multi_user_lan بالمفتاح، والعميل يتطلب فتح القفل. كانت تُفتح عند كل إقلاع بلا
     أي بوابة ترخيص. تُعاد المراجعة عند كل تغيّر في الترخيص أو القفل. */
  useEffect(() => {
    if (!storesHydrated || licenseAudit.status === 'checking') return
    const { lanHost, lanClient } = useAppStore.getState()
    const lan = useLanStatusStore.getState()
    const unlocked = lockReason === null
    const hostConfigured = lanHost.enabled && lanHost.pairingCode !== ''
    if (!unlocked || !hasFeature(licenseState, 'multi_user_lan')) {
      if (lan.hostRunning) void stopHostSession()
    } else if (hostConfigured && !lan.hostRunning) {
      void startHostSession({ pairingCode: lanHost.pairingCode, port: lanHost.port, hostName: lanHost.hostName }).catch(() => undefined)
    }
    if (!unlocked) {
      if (lan.role === 'client') disconnectRemoteSession()
    } else if (!hostConfigured && lanClient.enabled && lanClient.hostUrl && lan.role !== 'client') {
      bootRemoteSession()
    }
  }, [storesHydrated, licenseAudit.status, licenseState, lockReason])

  // ─── مزامنة الترخيص و«حول» من عامل التحكم — عند الإقلاع وكل 6 ساعات ───
  useEffect(() => {
    if (!legalAccepted) return
    let cancelled = false
    const sync = async () => {
      const devId = useAppStore.getState().deviceId
      const [about, accountMessage, revokedDevbot, revokedServices, flags] = await Promise.all([
        fetchAbout(LICENSE_CLOUD_BASE_URL),
        fetchAccountMessage(LICENSE_CLOUD_BASE_URL, devId), // رسالة المطوّر لهذا الجهاز (عرض فقط)
        fetchRevocationList(LICENSE_CLOUD_BASE_URL),
        /* ث8: لكل عامل قائمة إبطال مستقلة — نقرأهما معاً ونوحّدهما، وإلا فالحرق
           من العامل الآخر لا يصل ويبقى المفتاح المحروق يعمل عند العميل. */
        fetchRevocationList(APP_SERVICES_CLOUD_BASE_URL),
        fetchDeviceFlags(APP_SERVICES_CLOUD_BASE_URL, devId), // يبقى عبر العامل الكامل
      ])
      if (cancelled) return
      const revoked = mergeRevocationLists(revokedDevbot, revokedServices)
      // فشل الجلب (أوفلاين) لا يمس آخر بيانات محفوظة
      if (about !== null || accountMessage !== null || revoked !== null || flags !== null) {
        setCloudData({
          ...(about !== null ? { about } : {}),
          ...(accountMessage !== null ? { accountMessage } : {}),
          ...(revoked !== null ? { revoked } : {}),
          ...(flags !== null ? { flags } : {}),
        })
      }
    }
    sync()
    const t = setInterval(sync, 6 * 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [setCloudData, legalAccepted])

  // ─── تنبيهات المطوّر من البوت — تحديث دوري كل دقيقة وعند العودة للتطبيق ───
  useEffect(() => {
    let cancelled = false
    const syncNotices = async () => {
      if (!legalAccepted || !useAppStore.getState().setup.completed) return
      const deviceId = useAppStore.getState().deviceId
      const notices = await fetchCloudNotices(LICENSE_CLOUD_BASE_URL, deviceId)
      if (!cancelled && notices !== null) setCloudData({ notifications: notices })
    }
    void syncNotices()
    const timer = setInterval(() => { void syncNotices() }, 60_000)
    window.addEventListener('focus', syncNotices)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', syncNotices)
    }
  }, [setCloudData, legalAccepted])

  /* ─── بند 2 (تدقيق 2026-10-08): إبلاغ المطوّر بكل عميل جديد ───────────────
     ما كان: المعالج يجمع الاسم والهاتف والبريد والمنشأة والنشاط ثم لا يُرسل
     شيء إطلاقاً — لا POST في الكود كله. الآن بلاغ واحد لكل جهاز بعد اكتمال
     الإعداد. القواعد: fire-and-forget (لا يعطّل الإقلاع ولا العمل)، مرة واحدة
     (العلامة تُحفظ عند النجاح فقط)، ويصلح أوفلاين بالمحاولة في الإقلاع التالي.
     يُرسل الحقول المعلنة فقط (المنشأة والمالك والتواصل والعنوان والنشاط + معرّف الجهاز)
     — انظر core/registration.ts. */
  useEffect(() => {
    if (!setup.completed || !legalAccepted) return
    let cancelled = false
    const report = async () => {
      const app = useAppStore.getState()
      /* v1.0.22: البلاغ إلزامي بقبول الاتفاقية — لا خانة موافقة منفصلة. هذا المسار
         يغطي الأجهزة التي أكملت الإعداد قبل هذا الإصدار، ومَن فشل إرساله عند الإنشاء. */
      if (!shouldReportRegistration({
        setupCompleted: app.setup.completed,
        deviceId: app.deviceId,
        reportedAt: app.registrationReportedAt,
      })) return
      const payload = buildRegistrationReport({
        deviceId: app.deviceId,
        shopName: app.setup.shopName,
        ownerName: app.setup.ownerName,
        phone: app.setup.phone,
        email: app.setup.email,
        city: app.setup.city,
        street: app.setup.street,
        activityNameAr: ACTIVITY_TEMPLATES.find((t) => t.id === app.setup.activityId)?.nameAr ?? '',
      })
      if (!payload) return
      const result = await sendRegistrationReport(LICENSE_CLOUD_BASE_URL, payload)
      // الفشل (أوفلاين) لا يُعلَّم ⇒ تُعاد المحاولة في الإقلاع التالي
      if (!cancelled && result !== 'failed') app.markRegistrationReported()
    }
    void report()
    return () => { cancelled = true }
  }, [setup.completed, legalAccepted])

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
      if (currentLockReason(lic, app) !== null || !hasFeature(lic, 'telegram_bot')) return
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
      const appNow = useAppStore.getState()
      if (!isBackupDue(appNow.lastHourlyBackupAt, now, appNow.backupIntervalMinutes * 60_000)) return
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

  // ─── المزامنة السحابية متعددة الأجهزة (Supabase — ميزة cloud_sync): دورة كل دقيقة ───
  useEffect(() => {
    if (!setup.completed) return
    watchLocalChanges() // يرفع علم dirty عند أي تغيير محلي
    const tick = async () => {
      const app = useAppStore.getState()
      if (!app.sync.enabled) return
      const lic = evaluateLicense({
        activatedPayload: app.activatedPayload, trialStartedAt: app.trialStartedAt,
        lastSeenAt: app.lastSeenAt, today: new Date().toISOString(),
      })
      if (currentLockReason(lic, app) !== null || !hasFeature(lic, 'cloud_sync')) return
      // مفتاح الإطفاء السحابي (البند 5): ميزة ممنوحة لكن المطوّر أطفأها مؤقتاً
      if (lic.status === 'active' && !effectiveFeatures(lic.payload.features, app.deviceFlags).includes('cloud_sync')) return
      await runSyncCycle() // أخطاؤها تُسجل في sync.lastResult ولا ترمي أبداً
    }
    tick()
    const t = setInterval(tick, 60 * 1000)
    return () => clearInterval(t)
  }, [setup.completed])

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
    const beat = () => { touchLastSeen(); syncDesktopAnchor() }
    beat()
    const t = setInterval(beat, 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [touchLastSeen])

  // سجل التطبيق التقني (طلب المالك): مصائد الأخطاء العامة + حدث الإقلاع —
  // حلقة محلية على الجهاز، تُرسل للمطوّر فقط بموافقة صريحة من شاشة الدعم
  useEffect(() => {
    installErrorHooks()
    logEvent('info', 'app: إقلاع التطبيق')
  }, [])

  // بذر البيانات الأولية (قسم عام + مخزن رئيسي) فور اكتمال المعالج
  useEffect(() => {
    if (setup.completed) seed(setup.features)
  }, [setup.completed, setup.features, seed])

  // الإهلاك التلقائي (طلب المالك): لو نُسي الترحيل، تُرحَّل كل الأشهر المتأخرة عند فتح البرنامج
  // ثم فحص يومي — لا يعتمد على تدخل المالك إطلاقاً
  useEffect(() => {
    if (!setup.completed) return
    const run = () => {
      try {
        const n = useDataStore.getState().runAutoDepreciation()
        if (n > 0) logEvent('info', `assets: رُحّل الإهلاك التلقائي (${n} قيد شهري)`)
      } catch { /* لا يعطل الإقلاع */ }
    }
    run()
    const t = setInterval(run, 24 * 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [setup.completed])

  /* ث1: لا حكم على الترخيص (ولا شاشة قفل) قبل انتهاء إعادة التحقق من التوقيع —
     وإلا ومضت شاشة «انتهى اشتراكك» لعميل مفعّل في نافذة الفحص. */
  if (setup.completed && licenseAudit.status === 'checking') {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="text-center space-y-3">
            <div className="text-4xl animate-pulse">🔐</div>
            <div className="text-[13px] font-black text-slate-400">جارٍ التحقق من سلامة الترخيص…</div>
          </div>
        </div>
        <ToastHost />
      </>
    )
  }

  // القفل (القرار 28): بعد اكتمال الإعداد، أي حالة غير سارية ⇒ الشاشة المقفلة فقط
  if (setup.completed && lockReason) {
    return (
      <>
        <LockScreen reason={lockReason} state={licenseState} />
        <ToastHost />
        {/* بند 10: العميل المقفول **أحوج** من غيره لتنبيه المطوّر (تعليمات التجديد،
            «أُرسل مفتاحك — أعد التشغيل»)، والاستطلاع يعمل في هذه الحالة أيضاً، فبدون
            التركيب هنا تصل التنبيهات ولا يعرضها شيء — ولا جرس في شاشة القفل. */}
        <DevNoticeHost />
      </>
    )
  }

  // تبويب ثانٍ مفتوح = حماية التسلسلات: لا كتابة من هنا (البند 4 — لا أرقام مستندات مكررة)
  if (readOnlyTab) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-slate-100 dark:bg-slate-950">
        <div className="max-w-md text-center space-y-4 p-8 rounded-3xl bg-white dark:bg-card-dark border border-amber-500/30 shadow-2xl anim-pop">
          <div className="text-5xl">🔒</div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white">التطبيق مفتوح في نافذة أخرى</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            لحماية أرقام الفواتير والسندات من التكرار، الكتابة مسموحة من نافذة واحدة فقط.
            أغلق هذه النافذة وواصل عملك من النافذة الأصلية — أو أغلق الأصلية وحدّث هذه الصفحة.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
          >
            🔄 تحديث — هل أُغلقت النافذة الأخرى؟
          </button>
        </div>
      </div>
    )
  }

  return (
    <HashRouter>
      {!storesHydrated && hydrationFailure ? (
        <DataRecoveryScreen reason={hydrationFailure} />
      ) : !storesHydrated ? (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="text-center space-y-3">
            <div className="text-4xl animate-pulse">🏛️</div>
            <div className="text-[13px] font-black text-slate-400">تَحَكَّم — جارٍ فتح قاعدة البيانات…</div>
          </div>
        </div>
      ) : !legal ? (
        <><LegalGate /></>
      ) : setup.completed ? <Shell /> : <FirstRunWizard />}
      <ToastHost />
      {/* بند 10 (تدقيق 2026-10-08): نافذة تنبيه المطوّر المنبثقة. تظهر فقط لدرجتَي
          important/critical؛ أما info فبقي جرساً وتوستاً بلا مقاطعة.
          تُركَّب أيضاً في فرع شاشة القفل أعلاه (بوابة verify_dev_notice_levels تحصي
          التركيبين) — ولا تُركَّب في ومضة «جارٍ التحقق» العابرة ولا في تبويب القراءة
          فقط، حيث النافذة الأخرى هي التي تعمل ويكفيها تنبيه واحد. */}
      <DevNoticeHost />
      {/* معاينة الطباعة الحية — نافذة حرة فوق كل المسارات (طلب المالك):
          تبقى حية أثناء فتح قسم إعدادات الطباعة وتتحدث فوراً مع كل تغيير */}
      <ThermalPreview />
    </HashRouter>
  )
}
