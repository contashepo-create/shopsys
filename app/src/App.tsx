import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from './stores/app.store.ts'
import { useDataStore, useRawDataStore } from './data/repo.ts'
import { evaluateLicense, oldestValidDay, newestValidDay } from './core/license.ts'
import { currentLockReason, isBackupDue } from './core/security.ts'
import { fiscalCloseStateRepairs } from './core/fiscal.ts'
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
import { isElectronRuntime, isDesktopFreeWindows, desktopDatabaseStorage, desktopKeyRecoveryBridge, desktopBridge, type SatelliteDescriptor } from './data/desktopBridge.ts'
import { isSatelliteBoot, claimSatellite } from './ui/windows/satelliteState.ts'
import { SatelliteLayout, SatelliteViewRoot } from './ui/windows/satellite.tsx'
import { openSectionWindow, useWindowStore } from './ui/windows/windowStore.ts'
import { ActiveViewTab } from './ui/windows/WindowTabs.tsx'
import { desktopStorageFailure } from './data/persistentStorage.ts'
import { LockScreen } from './ui/LockScreen.tsx'
import { DevNoticeHost } from './ui/components/DevNoticeModal.tsx'
import { LoginScreen } from './ui/LoginScreen.tsx'
import { authRequired } from './core/auth.ts'
import { useSessionAuthStore, markSessionAuthenticated, clearSessionAuthenticatedFromMain } from './data/sessionAuth.ts'
import { buildAccentCssVars } from './core/appearance.ts'
import { decideTabLock, parseTabLock, TAB_HEARTBEAT_MS } from './core/concurrency.ts'
import { effectivePermissionsFor, rolesWithOverrides, canAccessPath, permissionForPath, PERMISSIONS } from './core/permissions.ts'
import { pathAllowedForSetup } from './core/coaVisibility.ts'
import { labelFor } from './core/activityLabels.ts'
import { useEffectiveBranchScope } from './ui/hooks/useNavSections.ts'
import { FirstRunWizard } from './ui/setup/FirstRunWizard.tsx'
import { LegalGate, LegalPage } from './ui/LegalGate.tsx'
import { LEGAL_VERSION } from './core/legal.ts'
import { MainLayout } from './ui/layout/MainLayout.tsx'

import { startHostSession, stopHostSession, useLanStatusStore } from './data/lan/hostSession.ts'
import { bootRemoteSession, disconnectRemoteSession } from './data/lan/remoteSession.ts'
import { installErrorHooks, logEvent } from './core/applog.ts'
import { ToastHost, useToast } from './ui/components/ui.tsx'
import { ThermalPreview } from './ui/components/ThermalPreview.tsx'
import { KeyboardNavigation } from './ui/components/KeyboardNavigation.tsx'
import { NAV_SECTIONS } from './ui/navCatalog.tsx'

const Dashboard = lazy(() => import('./ui/pages/Dashboard.tsx').then((module) => ({ default: module.Dashboard })))
const PermissionsPage = lazy(() => import('./ui/pages/PermissionsPage.tsx').then((module) => ({ default: module.PermissionsPage })))
const ItemsPage = lazy(() => import('./ui/pages/ItemsPage.tsx').then((module) => ({ default: module.ItemsPage })))
const WarehousesPage = lazy(() => import('./ui/pages/WarehousesPage.tsx').then((module) => ({ default: module.WarehousesPage })))
const BranchesPage = lazy(() => import('./ui/pages/BranchesPage.tsx').then((module) => ({ default: module.BranchesPage })))
const CustomersPage = lazy(() => import('./ui/pages/PartiesPages.tsx').then((module) => ({ default: module.CustomersPage })))
const SuppliersPage = lazy(() => import('./ui/pages/PartiesPages.tsx').then((module) => ({ default: module.SuppliersPage })))
const PurchasesPage = lazy(() => import('./ui/pages/PurchasesPage.tsx').then((module) => ({ default: module.PurchasesPage })))
const PurchaseReturnsPage = lazy(() => import('./ui/pages/PurchaseReturnsPage.tsx').then((module) => ({ default: module.PurchaseReturnsPage })))
const PurchaseOrdersPage = lazy(() => import('./ui/pages/PurchaseOrdersPage.tsx').then((module) => ({ default: module.PurchaseOrdersPage })))
const DocApprovalsPage = lazy(() => import('./ui/pages/ApprovalsPage.tsx').then((module) => ({ default: module.ApprovalsPage })))
const StocktakePage = lazy(() => import('./ui/pages/StocktakePage.tsx').then((module) => ({ default: module.StocktakePage })))
const RecipesPage = lazy(() => import('./ui/pages/RecipesPage.tsx').then((module) => ({ default: module.RecipesPage })))
const ProcessingPage = lazy(() => import('./ui/pages/ProcessingPage.tsx').then((module) => ({ default: module.ProcessingPage })))
const JewelryPage = lazy(() => import('./ui/pages/JewelryPage.tsx').then((module) => ({ default: module.JewelryPage })))
const PriceListsPage = lazy(() => import('./ui/pages/PriceListsPage.tsx').then((module) => ({ default: module.PriceListsPage })))
const PromotionsPage = lazy(() => import('./ui/pages/PromotionsPage.tsx').then((module) => ({ default: module.PromotionsPage })))
const PosPage = lazy(() => import('./ui/pages/PosPage.tsx').then((module) => ({ default: module.PosPage })))
const SalesInvoicesPage = lazy(() => import('./ui/pages/SalesInvoicesPage.tsx').then((module) => ({ default: module.SalesInvoicesPage })))
const InvoiceDocumentRoute = lazy(() => import('./ui/pages/InvoiceDocumentRoute.tsx').then((module) => ({ default: module.InvoiceDocumentRoute })))
const ContractingInvoicesPage = lazy(() => import('./ui/pages/ContractingInvoicesPage.tsx').then((module) => ({ default: module.ContractingInvoicesPage })))
const SaleReturnsPage = lazy(() => import('./ui/pages/SaleReturnsPage.tsx').then((module) => ({ default: module.SaleReturnsPage })))
const ShiftsPage = lazy(() => import('./ui/pages/ShiftsPage.tsx').then((module) => ({ default: module.ShiftsPage })))
const DeliveryTasksPage = lazy(() => import('./ui/pages/DeliveryTasksPage.tsx').then((module) => ({ default: module.DeliveryTasksPage })))
const JournalPage = lazy(() => import('./ui/pages/JournalPage.tsx').then((module) => ({ default: module.JournalPage })))
const CoaPage = lazy(() => import('./ui/pages/CoaPage.tsx').then((module) => ({ default: module.CoaPage })))
const TrialBalancePage = lazy(() => import('./ui/pages/TrialBalancePage.tsx').then((module) => ({ default: module.TrialBalancePage })))
const VouchersPage = lazy(() => import('./ui/pages/VouchersPage.tsx').then((module) => ({ default: module.VouchersPage })))
const TreasuryPage = lazy(() => import('./ui/pages/TreasuryPage.tsx').then((module) => ({ default: module.TreasuryPage })))
const PaymentTerminalsPage = lazy(() => import('./ui/pages/PaymentTerminalsPage.tsx').then((module) => ({ default: module.PaymentTerminalsPage })))
const ChequesPage = lazy(() => import('./ui/pages/ChequesPage.tsx').then((module) => ({ default: module.ChequesPage })))
const EinvoicePage = lazy(() => import('./ui/pages/EinvoicePage.tsx').then((module) => ({ default: module.EinvoicePage })))
const GeneralSettingsPage = lazy(() => import('./ui/pages/GeneralSettingsPage.tsx').then((module) => ({ default: module.GeneralSettingsPage })))
const CompanyProfilePage = lazy(() => import('./ui/pages/CompanyProfilePage.tsx').then((module) => ({ default: module.CompanyProfilePage })))
const LanSettingsPage = lazy(() => import('./ui/pages/LanSettingsPage.tsx').then((module) => ({ default: module.LanSettingsPage })))
const CostCentersPage = lazy(() => import('./ui/pages/CostCentersPage.tsx').then((module) => ({ default: module.CostCentersPage })))
const PrintSettingsPage = lazy(() => import('./ui/pages/PrintSettingsPage.tsx').then((module) => ({ default: module.PrintSettingsPage })))
const EmployeesPage = lazy(() => import('./ui/pages/EmployeesPage.tsx').then((module) => ({ default: module.EmployeesPage })))
const HrPage = lazy(() => import('./ui/pages/HrPage.tsx').then((module) => ({ default: module.HrPage })))
const InstallmentsPage = lazy(() => import('./ui/pages/InstallmentsPage.tsx').then((module) => ({ default: module.InstallmentsPage })))
const ReportsPage = lazy(() => import('./ui/pages/ReportsPage.tsx').then((module) => ({ default: module.ReportsPage })))
const NasqPage = lazy(() => import('./ui/pages/NasqPage.tsx').then((module) => ({ default: module.NasqPage })))
const StatementsPage = lazy(() => import('./ui/pages/StatementsPage.tsx').then((module) => ({ default: module.StatementsPage })))
const LicensePage = lazy(() => import('./ui/pages/LicensePage.tsx').then((module) => ({ default: module.LicensePage })))
const BackupPage = lazy(() => import('./ui/pages/BackupPage.tsx').then((module) => ({ default: module.BackupPage })))
const TripsPage = lazy(() => import('./ui/pages/TripsPage.tsx').then((module) => ({ default: module.TripsPage })))
const TripExpensesPage = lazy(() => import('./ui/pages/TripsPage.tsx').then((module) => ({ default: module.TripExpensesPage })))
const FleetPage = lazy(() => import('./ui/pages/FleetPage.tsx').then((module) => ({ default: module.FleetPage })))
const EquipmentPage = lazy(() => import('./ui/pages/EquipmentPage.tsx').then((module) => ({ default: module.EquipmentPage })))
const RentalContractsPage = lazy(() => import('./ui/pages/RentalContractsPage.tsx').then((module) => ({ default: module.RentalContractsPage })))
const LabOrdersPage = lazy(() => import('./ui/pages/LabPages.tsx').then((module) => ({ default: module.LabOrdersPage })))
const LabTestsPage = lazy(() => import('./ui/pages/LabPages.tsx').then((module) => ({ default: module.LabTestsPage })))
const LabPatientsPage = lazy(() => import('./ui/pages/LabPages.tsx').then((module) => ({ default: module.LabPatientsPage })))
const LabReferrersPage = lazy(() => import('./ui/pages/LabPages.tsx').then((module) => ({ default: module.LabReferrersPage })))
const ProjectsPage = lazy(() => import('./ui/pages/ContractingPages.tsx').then((module) => ({ default: module.ProjectsPage })))
const ProjectExpensesPage = lazy(() => import('./ui/pages/ContractingPages.tsx').then((module) => ({ default: module.ProjectExpensesPage })))
const ProjectExtractsPage = lazy(() => import('./ui/pages/ContractingPages.tsx').then((module) => ({ default: module.ProjectExtractsPage })))
const ContractingReportsPage = lazy(() => import('./ui/pages/ContractingReportsPage.tsx').then((module) => ({ default: module.ContractingReportsPage })))
const EquipmentReportsPage = lazy(() => import('./ui/pages/EquipmentReportsPage.tsx').then((module) => ({ default: module.EquipmentReportsPage })))
const RestaurantReportsPage = lazy(() => import('./ui/pages/RestaurantReportsPage.tsx').then((module) => ({ default: module.RestaurantReportsPage })))
const QuotationsPage = lazy(() => import('./ui/pages/QuotationsPage.tsx').then((module) => ({ default: module.QuotationsPage })))
const BoqPage = lazy(() => import('./ui/pages/ContractingDepthPages.tsx').then((module) => ({ default: module.BoqPage })))
const SubcontractorsPage = lazy(() => import('./ui/pages/ContractingDepthPages.tsx').then((module) => ({ default: module.SubcontractorsPage })))
const BondsPage = lazy(() => import('./ui/pages/ContractingDepthPages.tsx').then((module) => ({ default: module.BondsPage })))
const DailyWorkersPage = lazy(() => import('./ui/pages/ContractingDepthPages.tsx').then((module) => ({ default: module.DailyWorkersPage })))
const MaterialIssuesPage = lazy(() => import('./ui/pages/ProjectOpsPages.tsx').then((module) => ({ default: module.MaterialIssuesPage })))
const ClientCollectionsPage = lazy(() => import('./ui/pages/ProjectOpsPages.tsx').then((module) => ({ default: module.ClientCollectionsPage })))
const EvmDashboardPage = lazy(() => import('./ui/pages/ProjectOpsPages.tsx').then((module) => ({ default: module.EvmDashboardPage })))
const ApprovalsPage = lazy(() => import('./ui/pages/ProjectOpsPages.tsx').then((module) => ({ default: module.ApprovalsPage })))
const ProjectBudgetPage = lazy(() => import('./ui/pages/ContractingPlanPages.tsx').then((module) => ({ default: module.ProjectBudgetPage })))
const ProjectTasksPage = lazy(() => import('./ui/pages/ContractingPlanPages.tsx').then((module) => ({ default: module.ProjectTasksPage })))
const PropertiesPage = lazy(() => import('./ui/pages/RealEstatePages.tsx').then((module) => ({ default: module.PropertiesPage })))
const LeasesPage = lazy(() => import('./ui/pages/RealEstatePages.tsx').then((module) => ({ default: module.LeasesPage })))
const LogisticsInvoicesPage = lazy(() => import('./ui/pages/ActivityInvoicesHubs.tsx').then((module) => ({ default: module.LogisticsInvoicesPage })))
const RentalInvoicesPage = lazy(() => import('./ui/pages/ActivityInvoicesHubs.tsx').then((module) => ({ default: module.RentalInvoicesPage })))
const RealestateInvoicesPage = lazy(() => import('./ui/pages/ActivityInvoicesHubs.tsx').then((module) => ({ default: module.RealestateInvoicesPage })))
const CustodyPage = lazy(() => import('./ui/pages/CustodyPage.tsx').then((module) => ({ default: module.CustodyPage })))
const SyncPage = lazy(() => import('./ui/pages/SyncPage.tsx').then((module) => ({ default: module.SyncPage })))
const ClinicPatientsPage = lazy(() => import('./ui/pages/ClinicPages.tsx').then((module) => ({ default: module.ClinicPatientsPage })))
const ClinicAppointmentsPage = lazy(() => import('./ui/pages/ClinicPages.tsx').then((module) => ({ default: module.ClinicAppointmentsPage })))
const CarsPage = lazy(() => import('./ui/pages/CarsPage.tsx').then((module) => ({ default: module.CarsPage })))
const AboutPage = lazy(() => import('./ui/pages/AboutPage.tsx').then((module) => ({ default: module.AboutPage })))
const ProfilePage = lazy(() => import('./ui/pages/ProfilePage.tsx').then((module) => ({ default: module.ProfilePage })))
const AuditLogPage = lazy(() => import('./ui/pages/AuditLogPage.tsx').then((module) => ({ default: module.AuditLogPage })))
const IssuesPage = lazy(() => import('./ui/pages/IssuesPage.tsx').then((module) => ({ default: module.IssuesPage })))
const SupportPage = lazy(() => import('./ui/pages/SupportPage.tsx').then((module) => ({ default: module.SupportPage })))
const GuidesPage = lazy(() => import('./ui/pages/GuidesPage.tsx').then((module) => ({ default: module.GuidesPage })))
const WalletServicesPage = lazy(() => import('./ui/pages/WalletServicesPage.tsx').then((module) => ({ default: module.WalletServicesPage })))
const WastagePage = lazy(() => import('./ui/pages/WastagePage.tsx').then((module) => ({ default: module.WastagePage })))
const ConsumptionPage = lazy(() => import('./ui/pages/ConsumptionPage.tsx').then((module) => ({ default: module.ConsumptionPage })))
const BarcodeCenterPage = lazy(() => import('./ui/pages/BarcodeCenterPage.tsx').then((module) => ({ default: module.BarcodeCenterPage })))
const ScaleSettingsPage = lazy(() => import('./ui/pages/ScaleSettingsPage.tsx').then((module) => ({ default: module.ScaleSettingsPage })))
const OpeningBalancesPage = lazy(() => import('./ui/pages/OpeningBalancesPage.tsx').then((module) => ({ default: module.OpeningBalancesPage })))
const SerialsPage = lazy(() => import('./ui/pages/SerialsPage.tsx').then((module) => ({ default: module.SerialsPage })))
const SettlementsPage = lazy(() => import('./ui/pages/SettlementsPage.tsx').then((module) => ({ default: module.SettlementsPage })))
const ExchangePage = lazy(() => import('./ui/pages/ExchangePage.tsx').then((module) => ({ default: module.ExchangePage })))
const RestaurantOrdersPage = lazy(() => import('./ui/pages/RestaurantOrdersPage.tsx').then((module) => ({ default: module.RestaurantOrdersPage })))
const MaintenancePage = lazy(() => import('./ui/pages/MaintenancePage.tsx').then((module) => ({ default: module.MaintenancePage })))
const LaundryPage = lazy(() => import('./ui/pages/LaundryPage.tsx').then((module) => ({ default: module.LaundryPage })))
const BookingsPage = lazy(() => import('./ui/pages/BookingsPage.tsx').then((module) => ({ default: module.BookingsPage })))
const TransfersPage = lazy(() => import('./ui/pages/TransfersPage.tsx').then((module) => ({ default: module.TransfersPage })))
const AppearancePage = lazy(() => import('./ui/pages/AppearancePage.tsx').then((module) => ({ default: module.AppearancePage })))
const TelegramPage = lazy(() => import('./ui/pages/TelegramPage.tsx').then((module) => ({ default: module.TelegramPage })))
const AssetsPage = lazy(() => import('./ui/pages/AssetsPage.tsx').then((module) => ({ default: module.AssetsPage })))
const ExternalCommissionsPage = lazy(() => import('./ui/pages/ExternalCommissionsPage.tsx').then((module) => ({ default: module.ExternalCommissionsPage })))

function usePageTitle(): string {
  const { pathname } = useLocation()
  const { effectiveActivityId: activityId } = useEffectiveBranchScope()
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

function Shell({ satellite = false }: { satellite?: boolean }) {
  const title = usePageTitle()
  const location = useLocation()
  const navigate = useNavigate()
  const { effectiveBranch, effectiveModules, effectiveActivityId } = useEffectiveBranchScope()
  const setActiveBranchContext = useAppStore((s) => s.setActiveBranchContext)
  const setupState = useAppStore((s) => s.setup)
  useEffect(() => {
    setActiveBranchContext(effectiveBranch ? {
      id: effectiveBranch.id,
      nameAr: effectiveBranch.nameAr,
      isMain: effectiveBranch.isMain,
      warehouseId: effectiveBranch.warehouseId,
      customModulesMode: effectiveBranch.customModulesMode,
      enabledModules: effectiveBranch.enabledModules,
      activityId: effectiveBranch.activityId,
    } : null)
  }, [effectiveBranch, setActiveBranchContext])
  const effectiveFeatures = ACTIVITY_TEMPLATES.find((activity) => activity.id === effectiveActivityId)?.features ?? setupState.features

  /* تخطيط حسب نوع النافذة (قرار المالك 2026-10-22): الرئيسية والويب بالشكل
     الكامل، ونوافذ القمر الحرة بغلاف خفيف (شريط تحكم النظام هو عنوانها).
     ملاحظة: بوابة الوحدات لا تُعفى القمر منها — قسم مفعّل ملغى للنشاط لا
     يُفتح عبر رابط مباشر حتى من نافذة حرة. */
  const Layout = (satellite ? SatelliteLayout : MainLayout) as React.ComponentType<{ title?: string; children: React.ReactNode }>

  /* ── تبويبات النافذة الأم (قرار المالك2026-10-26): الأقسام والعروض تُفتح
     كتاباباً داخل الرئيسية — مزامنة الراوتر مع المتجر باتجاهين واحدة. ── */
  const windowTabs = useWindowStore((s) => s.tabs)
  const viewActiveTabId = useWindowStore((s) => s.viewActiveTabId)
  const pendingPath = useWindowStore((s) => s.pendingPath)
  const viewActiveTab = viewActiveTabId ? windowTabs.find((tab) => tab.id === viewActiveTabId) ?? null : null
  useEffect(() => {
    if (satellite || !isDesktopFreeWindows()) return
    const current = `${location.pathname}${location.search}`
    const store = useWindowStore.getState()
    store.syncCurrentPath(current)
    /* تنقّل داخلي أثناء عرض تبويب (روابط داخل الصفحة العلوية مثلاً) يعيد
       المحتوى للراوتر — التبويب يبقى في الشريط ويُستعاد بالنقر عليه. */
    if (store.viewActiveTabId) useWindowStore.setState({ viewActiveTabId: null })
  }, [satellite, location.pathname, location.search])
  useEffect(() => {
    if (pendingPath == null || satellite) return
    useWindowStore.getState().setPendingPath(null)
    const current = `${location.pathname}${location.search}`
    if (pendingPath !== current) navigate(pendingPath, { replace: true })
  }, [pendingPath, satellite, location.pathname, location.search, navigate])

  /* الرئيسية مشغّل — نسخة التبويبات (قرار المالك2026-10-26): أي تنقّل لغير
     لوحة التحكم على سطح المكتب يفتح القسم تبويباً داخل هذه النافذة نفسها
     بدل نافذة حرة مستقلة، ولا تعود الرئيسية للوحة التحكم — التبويب هو العرض.
     عند بلوغ10 تبويبات يعود openSectionWindow لسلوكه القديم (نافذة قسم)
     وهنا يرتد المحتوى للوحة التحكم حتى لا يُعرض القسم مرتين (نافذة + الرئيسية).
     في الويب لا جسر: التنقل الداخلي كما هو حرفياً. */
  useEffect(() => {
    if (satellite || !isDesktopFreeWindows()) return
    if (!setupState.completed || location.pathname === '/') return
    const raw = useRawDataStore.getState()
    if (raw.loggedOut || !useSessionAuthStore.getState().authenticated) return
    /* الفواتير حرة (قرار المالك2026-10-26): مسار مستند الفاتورة يفتح نافذته
       ثم يعود للقائمة بفعل InvoiceDocumentRoute نفسه — لا يحجز تبويباً هنا. */
    if (location.pathname === '/sales/invoices/new' || location.pathname === '/purchases/invoices/new') return
    const current = `${location.pathname}${location.search}`
    openSectionWindow(current, title)
    /* لم يحجز تبويب المسار (فتح نافذة حرة عند الحد الأقصى) → الرئيسية للوحة */
    const claimed = useWindowStore.getState().tabs.some((tab) => tab.path === current)
    if (!claimed) navigate('/', { replace: true })
  }, [satellite, location.pathname, location.search, title, setupState.completed, navigate])

  // ─── بوابة تسجيل الدخول (سد ثغرة انتحال الصلاحيات): PIN إجباري متى فُعّلت المصادقة ───
  /* الهوية والمصادقة من المتجر الخام (غير مصفّاة بالفرع): بوابة الدخول
     وحساب «هل الدخول مطلوب؟» يجب أن يريا مستخدمي كل الفروع وبصمة المالك
     الحقيقية — الأدوار وحدها تبقى مصفّاة لأن تجاوزات الفرع تُدمج فيها. */
  const { appUsers, currentUserId, ownerPinHash, loggedOut } = useRawDataStore()
  const { roleOverrides, customRoles } = useDataStore()
  // علم «الجلسة مصادَق عليها» — متجر React: تتغيّر البوابة فور تغيّره
  const sessionAuthenticated = useSessionAuthStore((s) => s.authenticated)
  const activeUser = appUsers.find((u) => u.id === currentUserId) ?? null
  // بوابة الدخول + إصلاح باج «إجبار تغيير الرقم أول دخول»: login() كان يرفع loggedOut
  // فتختفي شاشة الدخول قبل ظهور مودال التغيير الإجباري — الآن من عليه mustChangePin
  // يبقى محتجزاً في LoginScreen (بمودالها الإجباري) حتى يعيّن رقمه الخاص
  // + جلسة جديدة (إغلاق التطبيق فعلياً وإعادة فتحه) تُفرض من جديد دوماً حتى لو لم
  // يُسجَّل خروج صريح — عبر useSessionAuthStore المحصور بعمر النافذة (طلب المالك)
  // إصلاح بلاغ 2026-10-21: العلم في الذاكرة هو المعتمد بعد نجاح الدخول —
  // لا يعتمد على sessionStorage (محظور في تطبيق سطح المكتب على file://)
  if (authRequired(ownerPinHash, appUsers.filter((u) => u.active).length) && (loggedOut || !sessionAuthenticated || activeUser?.mustChangePin)) {
    return <LoginScreen />
  }
  // ─── حراسة الوحدات (سد ثغرة الرابط المباشر): شاشة وحدة غير مفعلة للنشاط ───
  // يُستخدم نفس النشاط والوحدات الفعالة للقائمة، بما فيها تخصيص الفرع، منعاً لاختلاف الرابط المباشر.
  if (!pathAllowedForSetup(location.pathname, effectiveModules, effectiveFeatures, effectiveActivityId)) {
    return (
      <Layout title="غير متاح لنشاطك">
        <div className="max-w-lg mx-auto mt-16 text-center space-y-4 p-10 rounded-3xl bg-white dark:bg-card-dark border border-amber-500/25 anim-pop">
          <div className="text-5xl">🔒</div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white">هذه الشاشة غير مفعلة لنشاطك</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            هذا القسم يخص وحدة عمل غير مفعلة في نشاطك الحالي.
            تفعيل الأقسام الإضافية يتم عبر المطوّر بمفتاح موقّع.
          </p>
        </div>
      </Layout>
    )
  }
  const perms = effectivePermissionsFor(activeUser, rolesWithOverrides(roleOverrides, customRoles, effectiveActivityId))
  if (!canAccessPath(location.pathname, perms)) {
    const needed = permissionForPath(location.pathname)
    const permName = PERMISSIONS.find((p) => p.id === needed)?.nameAr ?? needed
    return (
      <Layout title="غير مصرح">
        <div className="max-w-lg mx-auto mt-16 text-center space-y-4 p-10 rounded-3xl bg-white dark:bg-card-dark border border-rose-500/25 anim-pop">
          <div className="text-5xl">🚫</div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white">هذه الشاشة تحتاج صلاحية</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            حسابك «{activeUser?.nameAr ?? 'الحالي'}» لا يملك صلاحية «{permName}».
            اطلب من المالك منحها لدورك أو لحسابك من شاشة الصلاحيات.
          </p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title={viewActiveTab ? viewActiveTab.title : title}>
      {/* ملاحة المفاتيح العامة تبقى مركّبة دائماً (F12/F7/Enter…) — حتى أثناء
          عرض تبويب محرر، فتبقى الاختصارات العالمية حيّة كما في نافذة قمر. */}
      <KeyboardNavigation />
      {viewActiveTab ? <ActiveViewTab tab={viewActiveTab} /> : (
        <>
      <Suspense fallback={<div role="status" className="rounded-xl border border-slate-200 bg-white/80 px-4 py-6 text-center text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-card-dark">جارٍ تحميل الشاشة…</div>}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings/permissions" element={<PermissionsPage />} />
        <Route path="/settings/general" element={<GeneralSettingsPage />} />
        <Route path="/settings/company" element={<CompanyProfilePage />} />
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
        <Route path="/sales/delivery-tasks" element={<DeliveryTasksPage />} />
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
      <Route path="/contracting/extracts" element={<ProjectExtractsPage />} />
      <Route path="/contracting/expenses" element={<ProjectExpensesPage />} />
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
        <Route path="/logistics/expenses" element={<TripExpensesPage />} />
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
      </Suspense>
        </>
      )}
    </Layout>
  )
}

/** شاشة استرداد: تظهر حين تعذّر قراءة البيانات — لا معالج إعداد ولا كتابة فوق البيانات */
function DataRecoveryScreen({ reason }: { reason: string }) {
  const keyMismatch = /enc:v1|فك تشفير|مفتاح الجهاز/i.test(reason)
  const [freshStartBusy, setFreshStartBusy] = useState(false)
  const [freshStartMessage, setFreshStartMessage] = useState<string | null>(null)
  const startFresh = async () => {
    const bridge = desktopKeyRecoveryBridge()
    if (!bridge) return
    setFreshStartBusy(true)
    setFreshStartMessage(null)
    try {
      const result = await bridge.startFresh()
      if (result.ok) setFreshStartMessage(`حُفظت نسخة أرشيف من القاعدة في: ${result.archivePath ?? 'مجلد الأرشيف'} — سيُعاد تشغيل البرنامج بقاعدة جديدة.`)
      else if (!result.canceled) setFreshStartMessage(result.reason ?? 'تعذّر بدء القاعدة الجديدة؛ لم تُحذف النسخة الأرشيفية.')
    } catch (error) {
      setFreshStartMessage((error as Error).message)
    } finally {
      setFreshStartBusy(false)
    }
  }
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 bg-slate-100 dark:bg-slate-950">
      <div className="max-w-lg space-y-4 p-8 rounded-3xl bg-white dark:bg-card-dark border border-rose-500/30 shadow-2xl">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-black text-slate-800 dark:text-white">تعذّر فتح بياناتك — لم يبدأ إعداد جديد</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          لم تُفتح القاعدة ولم تُكتب الحالة الافتراضية فوقها. لا تحذف ملفات البيانات يدوياً؛ اتبع التعليمات أدناه حسب حالتك.
        </p>
        {keyMismatch ? (
          <>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed space-y-2">
              <b className="block text-amber-700 dark:text-amber-300">تحتوي القاعدة على لقطة قديمة مشفّرة <span dir="ltr">enc:v1</span> تعذّر التحقق منها بالمفتاح الحالي (قد يكون غير متاح أو غير مطابق)؛ لم تُفتح القاعدة ولم تُكتب فوقها.</b>
              <ol className="list-decimal pr-5 space-y-1">
                <li>إن كان لديك ملف مفتاح استرداد <span dir="ltr">.tkey</span> وكلمة مروره، أدخلهما أدناه؛ يجب أن يحتوي الملف على المفتاح الأصلي لهذه اللقطة.</li>
                <li>إن لم يكن لديك الملف، احتفظ بمجلد بيانات التطبيق كما هو (بما فيه <span dir="ltr">Local State</span> و<span dir="ltr">device.key.enc</span> و<span dir="ltr">db-location.json</span> و<span dir="ltr">backups</span>) وبملف <span dir="ltr">shopsys.db</span> دون تعديل أو استبدال.</li>
                <li>إن كان ملف التعريف/حساب Windows الأصلي متاحاً، استخدمه لاستعادة المفتاح الأصلي ثم أعد المحاولة.</li>
              </ol>
              <p className="font-bold">لا يمكن ترحيل اللقطة القديمة بلا مفتاحها الأصلي. اللقطات الجديدة لا تحتاج هذا المفتاح؛ ولجهاز الاختبار فقط يمكن بدء قاعدة فارغة مع حفظ القاعدة القديمة في الأرشيف.</p>
            </div>
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4 space-y-3">
              <div className="text-[12px] text-slate-700 dark:text-slate-200 leading-relaxed">
                <b className="block text-rose-700 dark:text-rose-300">بدء نظيف — للجهاز التجريبي الذي لا يحتوي بيانات عملاء</b>
                سيبدأ معالج الإعداد كأول تشغيل، مع حفظ ملف القاعدة الحالية كما هو. إذا احتوى <span dir="ltr">enc:v1</span> فالأرشيف وحده لا يفكّها دون المفتاح الأصلي. لا تُحذف النسخ القديمة، لكنها لن تُستعاد تلقائياً بعد هذا الاختيار؛ ولا يعيد ذلك ضبط هوية الجهاز أو الترخيص/مدة التجربة.
              </div>
              <button
                type="button"
                disabled={freshStartBusy}
                onClick={() => { void startFresh() }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 transition-colors"
              >
                {freshStartBusy ? 'جارٍ حفظ الأرشيف…' : 'بدء قاعدة جديدة مع حفظ الأرشيف'}
              </button>
              {freshStartMessage && <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 break-all">{freshStartMessage}</p>}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            لم يبدأ التطبيق إعداداً جديداً ولم يغيّر ملفات البيانات. اترك الملفات المحلية كما هي، وتحقق من وجود مجلد البيانات الذي اختير سابقاً ثم أعد المحاولة.
          </p>
        )}
        <p dir="ltr" className="text-[11px] font-mono text-rose-600 dark:text-rose-400 break-all">{reason}</p>
        <button
          onClick={() => {
            const retryStartup = desktopKeyRecoveryBridge()?.retryStartup
            if (!retryStartup) { window.location.reload(); return }
            void retryStartup().then((restarted) => {
              if (!restarted) window.location.reload()
            }).catch(() => window.location.reload())
          }}
          className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
        >
          🔄 إعادة المحاولة
        </button>
        {/* استرداد المفتاح اختياري؛ البدء النظيف لا يُنفذ إلا بخيار التأكيد الصريح أعلاه */}
        <DesktopKeyRecoveryImport />
      </div>
    </div>
  )
}

/** معرف هذا التبويب — ثابت طوال حياته */
const TAB_ID = `tab-${Math.random().toString(36).slice(2, 10)}`
const TAB_LOCK_KEY = 'shopsys-tab-lock'

export default function App() {
  useEffect(() => {
    const auth = window.shopsysDesktop?.auth
    return auth?.onRevoked(clearSessionAuthenticatedFromMain)
  }, [])
  /* §101 التنفيذية: بوابة ترطيب المتجرين — داخل Electron فقط (القراءة من
     SQLite عبر IPC غير متزامنة، فبدون البوابة يومض معالج التثبيت أول كل
     إقلاع). في المتصفح الترطيب متزامن فلا بوابة أصلاً — سلوك الويب
     والاختبارات كما هو حرفياً. */
  const needsHydrationGate = isElectronRuntime()
  const [storesHydrated, setStoresHydrated] = useState(() => {
    if (!needsHydrationGate) return true
    try {
      const hydrated = useAppStore.persist.hasHydrated() && useDataStore.persist.hasHydrated()
      if (hydrated) {
        const mainBranch = useRawDataStore.getState().branches.find((branch) => branch.isMain)
        const fiscal = useAppStore.getState()
        if (mainBranch && fiscal.fiscalYears.some((year) => year.branchId == null)) {
          fiscal.bindLegacyFiscalYearsToMain(mainBranch.id)
        }
      }
      return hydrated
    } catch { return true }
  })
  /* v1.0.19: فشل قراءة القاعدة ≠ «عميل جديد». كان المؤقت القديم (5 ثوانٍ) يفتح البوابة
     بحالة افتراضية فيظهر معالج الإعداد وكأن البيانات اختفت. الآن: لا فتح بلا ترطيب
     حقيقي، وفشل القراءة يعرض شاشة استرداد بدل المعالج (والكتابة ممنوعة). */
  const [hydrationFailure, setHydrationFailure] = useState<string | null>(null)
  const [storageConflict, setStorageConflict] = useState<{ storeName: string; message: string } | null>(null)
  useEffect(() => {
    const onConflict = (event: Event) => {
      const detail = (event as CustomEvent<{ storeName?: unknown; message?: unknown }>).detail
      setStorageConflict({
        storeName: typeof detail?.storeName === 'string' ? detail.storeName : 'قاعدة البيانات',
        message: typeof detail?.message === 'string' ? detail.message : 'توقّف الحفظ لتعارض تعديلات بين النوافذ',
      })
    }
    window.addEventListener('shopsys-storage-conflict', onConflict)
    return () => window.removeEventListener('shopsys-storage-conflict', onConflict)
  }, [])
  useEffect(() => {
    if (storesHydrated) return
    const check = () => {
      const failure = desktopStorageFailure()
      if (failure) { setHydrationFailure(failure); return }
      try {
        if (useAppStore.persist.hasHydrated() && useDataStore.persist.hasHydrated()) {
          const mainBranch = useRawDataStore.getState().branches.find((branch) => branch.isMain)
          const fiscal = useAppStore.getState()
          if (mainBranch && fiscal.fiscalYears.some((year) => year.branchId == null)) {
            fiscal.bindLegacyFiscalYearsToMain(mainBranch.id)
          }
          setStoresHydrated(true)
        }
      } catch { setStoresHydrated(true) }
    }
    const offApp = useAppStore.persist.onFinishHydration(check)
    const offData = useDataStore.persist.onFinishHydration(check)
    check()
    const poll = setInterval(check, 500) /* فشل الترطيب لا يُطلق onFinishHydration */
    return () => { offApp(); offData(); clearInterval(poll) }
  }, [storesHydrated])
  // ترحيل سنوات ما قبل عزل الفروع: تُسند الفترات القديمة غير الموسومة إلى الرئيسي
  // قبل إظهار التطبيق؛ وإلا قد تُعامل فترة قديمة كأنها تغطي دفاتر كل الفروع.
  useEffect(() => {
    if (!storesHydrated) return
    const mainBranch = useRawDataStore.getState().branches.find((branch) => branch.isMain)
    if (!mainBranch) return
    const fiscal = useAppStore.getState()
    if (fiscal.fiscalYears.some((year) => year.branchId == null)) {
      fiscal.bindLegacyFiscalYearsToMain(mainBranch.id)
    }
  }, [storesHydrated])
  // قيد اليومية هو سجلّ الحدث الحاسم؛ عند إقلاعٍ توقف بين حفظ الدفتر ومخزن
  // السنوات، نعيد مطابقة الحالة من القيود الموجودة فقط (لا ننشئ أي قيد هنا).
  useEffect(() => {
    if (!storesHydrated) return
    const fiscal = useAppStore.getState()
    const journal = useRawDataStore.getState().journal
    const repairs = fiscalCloseStateRepairs(fiscal.fiscalYears, journal)
    repairs.closeIds.forEach((id) => fiscal.markFiscalYearClosed(id))
    repairs.reopenIds.forEach((id) => fiscal.reopenFiscalYear(id))
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

  /* نافذة قمر حرة (سطح المكتب — قرار المالك 2026-10-22): العملية الرئيسية
     فتحت هذه النافذة برمز إقلاع في الرابط (?sat=). المطالبة تُثبت هويتنا
     والوصف يحدد ما نعرضه (قسم كامل أو عرض نافذة). الجلسة مصادَقة فوراً
     لأن القمر لا يُنشأ إلا من داخل نافذة دخلت أصلاً — ولا نطلب PIN مع
     كل نافذة. قبل المطالبة ينتظر العرض شاشة التحميل نفسها. */
  const satelliteBoot = isSatelliteBoot()
  const [satDescriptor, setSatDescriptor] = useState<SatelliteDescriptor | null>(null)
  const [satClaimed, setSatClaimed] = useState(!satelliteBoot)
  useEffect(() => {
    if (!satelliteBoot) return
    let cancelled = false
    void claimSatellite().then((descriptor) => {
      if (cancelled) return
      if (descriptor && !useRawDataStore.getState().loggedOut) markSessionAuthenticated()
      setSatDescriptor(descriptor)
      setSatClaimed(true)
    })
    return () => { cancelled = true }
  }, [satelliteBoot])

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
    if (satelliteBoot) return
    const bridge = desktopDatabaseStorage()
    if (!bridge?.recoveryNotice) return
    void bridge.recoveryNotice().then((notice) => {
      if (!notice) return
      const toast = useToast.getState()
      if (notice.from) toast.show('اكتُشف تلف في قاعدة البيانات واستُردت تلقائياً من أحدث نسخة سليمة ✓')
      else toast.show('تعذّر إيجاد نسخة سليمة — بدئت قاعدة جديدة. استعد بياناتك من «النسخ الاحتياطي ← استعادة نسخة قاعدة كاملة»', 'error')
    }).catch(() => { /* إشعار مساعد — لا يعطل الإقلاع */ })
  }, [satelliteBoot])

  // ─── بوابة الترخيص (القرار 28): تقييم الحالة + الحرق + مطابقة النشاط ───
  /* في سطح المكتب، Main هو المرجع الوحيد لفحص التوقيع من لقطة SQLite وهوية الجهاز؛
     الويب يحتفظ بالتحقق المحلي. لا تُشتق أي صلاحية من حمولة محفوظة غير موقّعة. */
  useEffect(() => {
    let cancelled = false
    const audit = () => {
      if (cancelled) return
      const verify = useAppStore.getState().reverifyActivation()
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('انتهت مهلة استجابة خدمة الترخيص المركزية')), 8_000)
      })
      void Promise.race([verify, timeout]).catch((error: unknown) => {
        if (timer) clearTimeout(timer)
        const current = useAppStore.getState()
        if (current.licenseAudit.status === 'checking') {
          /* الفشل أو التعليق البيئي لا يُسقط المفتاح ولا يترك شاشة التحميل أبدية؛
             يبقى التطبيق مقفلاً بوضوح حتى يمكن إعادة التحقق بأمان. */
          useAppStore.setState({
            activatedPayload: null,
            licenseAudit: {
              status: 'unverifiable',
              reason: error instanceof Error ? error.message : 'تعذّر إكمال التحقق المحلي من الترخيص',
              at: new Date().toISOString(),
            },
          })
          console.error('[license-audit] تعذّر إكمال التحقق عند الإقلاع:', error)
        }
      }).finally(() => { if (timer) clearTimeout(timer) })
    }
    /* لا ننتظر ترطيب shopsys-data: التوقيع ومفتاح الترخيص من shopsys-app فقط.
       انتظار المخزنين معاً كان يترك نافذة القمر على `checking` إن تأخر تحميل قاعدة
       البيانات، كما أن بوابة الترخيص كانت تُرسم قبل بوابة ترطيب قاعدة البيانات. */
    if (useAppStore.persist.hasHydrated()) audit()
    else {
      const off = useAppStore.persist.onFinishHydration(audit)
      return () => { cancelled = true; off() }
    }
    return () => { cancelled = true }
  }, [])

  useEffect(() => desktopBridge()?.license?.onInvalidated(() => {
    /* أعد قراءة اللقطة المعتمدة أولاً ثم اسأل Main؛ يمنع فحصاً بمفتاح قديم إذا
       وصل الإبطال قبل اكتمال إعادة ترطيب النافذة. */
    void Promise.resolve(useAppStore.persist.rehydrate())
      .catch((error: unknown) => {
        console.error('[license-audit] تعذّرت إعادة قراءة لقطة الترخيص؛ سيعيد Main الفحص من مصدره:', error)
      })
      .then(() => useAppStore.getState().reverifyActivation())
  }), [])

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
    if (satelliteBoot) return
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
  }, [satelliteBoot])

  // ─── شبكة المحل (§102): إقلاع دور الجهاز — مضيف مفعّل يفتح خادمه، وعميل
  // مفعل يعيد الاتصال بالمضيف تلقائياً بالتوكن المحفوظ (بلا رمز اقتران) ───
  /* ح7 (مراجعة ③): شبكة المحل لا تعمل خلف شاشة القفل ولا لغير المرخّص. المضيف يتطلب
     ميزة multi_user_lan بالمفتاح، والعميل يتطلب فتح القفل. كانت تُفتح عند كل إقلاع بلا
     أي بوابة ترخيص. تُعاد المراجعة عند كل تغيّر في الترخيص أو القفل. */
  useEffect(() => {
    if (!storesHydrated || satelliteBoot || licenseAudit.status === 'checking') return
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
  }, [storesHydrated, licenseAudit.status, licenseState, lockReason, satelliteBoot])

  // ─── مزامنة الترخيص و«حول» من عامل التحكم — عند الإقلاع وكل 6 ساعات ───
  useEffect(() => {
    if (!legalAccepted || satelliteBoot) return
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
  }, [setCloudData, legalAccepted, satelliteBoot])

  // ─── تنبيهات المطوّر من البوت — تحديث دوري كل دقيقة وعند العودة للتطبيق ───
  useEffect(() => {
    if (satelliteBoot) return
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
  }, [setCloudData, legalAccepted, satelliteBoot])

  /* ─── بند 2 (تدقيق 2026-10-08): إبلاغ المطوّر بكل عميل جديد ───────────────
     ما كان: المعالج يجمع الاسم والهاتف والبريد والمنشأة والنشاط ثم لا يُرسل
     شيء إطلاقاً — لا POST في الكود كله. الآن بلاغ واحد لكل جهاز بعد اكتمال
     الإعداد. القواعد: fire-and-forget (لا يعطّل الإقلاع ولا العمل)، مرة واحدة
     (العلامة تُحفظ عند النجاح فقط)، ويصلح أوفلاين بالمحاولة في الإقلاع التالي.
     يُرسل الحقول المعلنة فقط (المنشأة والمالك والتواصل والعنوان والنشاط + معرّف الجهاز)
     — انظر core/registration.ts. */
  useEffect(() => {
    if (!setup.completed || !legalAccepted || satelliteBoot) return
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
  }, [setup.completed, legalAccepted, satelliteBoot])

  // ─── الإرسال المجدول عبر التليجرام (القرار 32): تقرير اليوم + نسخة — مرة يومياً بعد ساعة الجدولة ───
  useEffect(() => {
    if (!setup.completed || satelliteBoot) return
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
  }, [setup.completed, satelliteBoot])

  // ─── النسخ الاحتياطي التلقائي كل ساعة (القرار 28): لقطة مشفرة على جهاز العميل ───
  useEffect(() => {
    if (!setup.completed || satelliteBoot) return
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
  }, [setup.completed, lastHourlyBackupAt, setLastHourlyBackupAt, satelliteBoot])

  // ─── المزامنة السحابية متعددة الأجهزة (Supabase — ميزة cloud_sync): دورة كل دقيقة ───
  useEffect(() => {
    if (!setup.completed || satelliteBoot) return
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
  }, [setup.completed, satelliteBoot])

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
    if (satelliteBoot) return
    const beat = () => { touchLastSeen(); syncDesktopAnchor() }
    beat()
    const t = setInterval(beat, 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [touchLastSeen, satelliteBoot])

  // سجل التطبيق التقني (طلب المالك): مصائد الأخطاء العامة + حدث الإقلاع —
  // حلقة محلية على الجهاز، تُرسل للمطوّر فقط بموافقة صريحة من شاشة الدعم
  useEffect(() => {
    installErrorHooks()
    logEvent('info', 'app: إقلاع التطبيق')
  }, [])

  // بذر البيانات الأولية (قسم عام + مخزن رئيسي) فور اكتمال المعالج
  useEffect(() => {
    if (setup.completed && !satelliteBoot) seed(setup.features)
  }, [setup.completed, setup.features, seed, satelliteBoot])

  // الإهلاك التلقائي (طلب المالك): لو نُسي الترحيل، تُرحَّل كل الأشهر المتأخرة عند فتح البرنامج
  // ثم فحص يومي — لا يعتمد على تدخل المالك إطلاقاً
  useEffect(() => {
    if (!setup.completed || satelliteBoot) return
    const run = () => {
      try {
        const n = useDataStore.getState().runAutoDepreciation()
        if (n > 0) logEvent('info', `assets: رُحّل الإهلاك التلقائي (${n} قيد شهري)`)
      } catch { /* لا يعطل الإقلاع */ }
    }
    run()
    const t = setInterval(run, 24 * 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [setup.completed, satelliteBoot])

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
      ) : !storesHydrated || !satClaimed ? (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="text-center space-y-3">
            <div className="text-4xl animate-pulse">🏛️</div>
            <div className="text-[13px] font-black text-slate-400">تَحَكَّم — جارٍ فتح قاعدة البيانات…</div>
          </div>
        </div>
      ) : !legal ? (
        <><LegalGate /></>
      ) : setup.completed ? (
        satDescriptor?.type === 'view'
          ? <SatelliteViewRoot descriptor={satDescriptor} />
          : <Shell satellite={satelliteBoot} />
      ) : <FirstRunWizard />}
      {storageConflict && (
        <div role="alert" className="fixed inset-x-4 bottom-4 z-[10000] mx-auto max-w-2xl rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950 shadow-2xl dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          <div className="font-black">توقّف الحفظ بسبب تعديل متزامن — {storageConflict.storeName}</div>
          <p className="mt-1 text-sm">{storageConflict.message}. لم يُستبدل التعديل المحفوظ في قاعدة البيانات. لا تواصل إدخال بيانات في هذه النافذة؛ دوّن أي تعديل غير محفوظ، ثم أغلق النوافذ الأخرى وأعد تحميل هذه النافذة.</p>
          <button onClick={() => window.location.reload()} className="mt-3 rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800">إعادة تحميل بعد تدوين التعديلات غير المحفوظة</button>
        </div>
      )}
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
