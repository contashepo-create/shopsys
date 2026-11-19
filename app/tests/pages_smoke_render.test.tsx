import { afterEach, describe, expect, it } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { AppErrorBoundary } from '../src/ui/AppErrorBoundary.tsx'
import { JournalPage } from '../src/ui/pages/JournalPage.tsx'
import { TrialBalancePage } from '../src/ui/pages/TrialBalancePage.tsx'
import { StatementsPage } from '../src/ui/pages/StatementsPage.tsx'
import { OpeningBalancesPage } from '../src/ui/pages/OpeningBalancesPage.tsx'
import { ItemsPage } from '../src/ui/pages/ItemsPage.tsx'
import { ChequesPage } from '../src/ui/pages/ChequesPage.tsx'
import { InstallmentsPage } from '../src/ui/pages/InstallmentsPage.tsx'
import { AssetsPage } from '../src/ui/pages/AssetsPage.tsx'
import { AuditLogPage } from '../src/ui/pages/AuditLogPage.tsx'
import { WarehousesPage } from '../src/ui/pages/WarehousesPage.tsx'
import { TripsPage } from '../src/ui/pages/TripsPage.tsx'
import { MaintenancePage } from '../src/ui/pages/MaintenancePage.tsx'
import { BranchesPage } from '../src/ui/pages/BranchesPage.tsx'
import { Dashboard } from '../src/ui/pages/Dashboard.tsx'
import { FinancialPositionReview } from '../src/ui/pages/FinancialPositionReview.tsx'
import { IssuesPage } from '../src/ui/pages/IssuesPage.tsx'
import { LanSettingsPage } from '../src/ui/pages/LanSettingsPage.tsx'
import { AppearancePage } from '../src/ui/pages/AppearancePage.tsx'
import { EquipmentPage } from '../src/ui/pages/EquipmentPage.tsx'
import { ExternalCommissionsPage } from '../src/ui/pages/ExternalCommissionsPage.tsx'
import { LaundryPage } from '../src/ui/pages/LaundryPage.tsx'
import { NasqPage } from '../src/ui/pages/NasqPage.tsx'
import { PaymentTerminalsPage } from '../src/ui/pages/PaymentTerminalsPage.tsx'
import { RentalContractsPage } from '../src/ui/pages/RentalContractsPage.tsx'
import { ScaleSettingsPage } from '../src/ui/pages/ScaleSettingsPage.tsx'
import { SyncPage } from '../src/ui/pages/SyncPage.tsx'
import { FinancialComparisonReview } from '../src/ui/pages/FinancialComparisonReview.tsx'
import { ClinicPatientsPage } from '../src/ui/pages/ClinicPages.tsx'
import { SalesInvoicesReportTab } from '../src/ui/pages/InvoiceReportsTabs.tsx'
import { FxHistoryRepair } from '../src/ui/pages/FxHistoryRepair.tsx'


/**
 * دخان الشاشات — «لا شاشة بيضاء».
 *
 * المراجعة المنهجية كشفت أن 29 شاشة من 100 لا يشير إليها أي اختبار: بوابة
 * المحرك تفحص الأرقام، وصفحات الإدخال تفحص القيود، لكن شاشات العرض (اليومية،
 * ميزان المراجعة، الكشوف، الأصول، الشيكات…) لم يكن أحد يرسمها آلياً — فأي
 * خطأ في ربط حقل أو مساحة اسم في الترجمة يظهر عند المالك لا في البوابة.
 *
 * هذا الملف يرسم كل شاشة حرجة على مخزن مبذور ويتحقق من: (١) لا انهيار،
 * (٢) مخرج نصي حقيقي على الشاشة، (٣) حدود الخطأ لا تلتقط شيئاً.
 */

const initial = useRawDataStore.getState()
const app = useAppStore.getState()

afterEach(() => {
  cleanup()
  useRawDataStore.setState(initial, true)
  useAppStore.setState(app, true)
})

function seedStore() {
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'SA', taxInclusive: false, vatPercent: 0,
      allowNegativeTreasury: true, allowNegativeStock: true, activityId: 'grocery', ownerName: 'المالك',
    } as never,
  })
  useRawDataStore.setState({
    ...initial, branches: [], activeBranchId: null, currentUserId: null, appUsers: [],
    items: [], customers: [], suppliers: [], employees: [], journal: [], sales: [], purchases: [],
    warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }], batches: [], stocktakes: [], shifts: [],
    cheques: [], installments: [], assets: [], trips: [], maintenanceJobs: [],
  } as never)
}

function mount(element: ReactElement) {
  return render(<MemoryRouter><AppErrorBoundary>{element}</AppErrorBoundary></MemoryRouter>)
}

const SCREENS: [string, () => ReactElement][] = [
  ['اليومية', () => (<JournalPage />)],
  ['ميزان المراجعة', () => (<TrialBalancePage />)],
  ['الكشوف', () => (<StatementsPage />)],
  ['الأرصدة الافتتاحية', () => (<OpeningBalancesPage />)],
  ['الأصناف', () => (<ItemsPage />)],
  ['الشيكات', () => (<ChequesPage />)],
  ['الأقساط', () => (<InstallmentsPage />)],
  ['الأصول الثابتة', () => (<AssetsPage />)],
  ['سجل التدقيق', () => (<AuditLogPage />)],
  ['المخازن', () => (<WarehousesPage />)],
  ['رحلات التوزيع', () => (<TripsPage />)],
  ['الصيانة', () => (<MaintenancePage />)],
  ['الفروع', () => (<BranchesPage />)],
  ['لوحة التحكم', () => (<Dashboard />)],
  ['المركز المالي (مراجعة)', () => (<FinancialPositionReview
    journal={[]} asOf="2026-12-31" names={{}} cur={{ code: 'SAR', symbol: 'ر.س', decimals: 2, name: 'ريال' }}
    companyName="متجر" scopeLabel="كل الفروع" scopeWarning=""
  />)],
  ['سجل الملاحظات', () => (<IssuesPage />)],
  ['الشبكة المحلية', () => (<LanSettingsPage />)],
  ['المظهر', () => (<AppearancePage />)],
  ['المعدات', () => (<EquipmentPage />)],
  ['عمولات خارجية', () => (<ExternalCommissionsPage />)],
  ['المغسلة', () => (<LaundryPage />)],
  ['النسخ (NASQ)', () => (<NasqPage />)],
  ['ماكينات الدفع', () => (<PaymentTerminalsPage />)],
  ['عقود الإيجار', () => (<RentalContractsPage />)],
  ['إعدادات الميزان', () => (<ScaleSettingsPage />)],
  ['المزامنة', () => (<SyncPage />)],
  ['مقارنة مالية', () => (<FinancialComparisonReview
    journal={[]} period={{ from: '2026-01-01', to: '2026-12-31' }} cashCodes={[]} names={{}}
    cur={{ code: 'SAR', symbol: 'ر.س', decimals: 2, name: 'ريال' }} companyName="متجر"
    scopeLabel="كل الفروع" scopeWarning="" profiles={[]} branches={[]} activeBranchId={null}
  />)],
  ['مرضى العيادة', () => (<ClinicPatientsPage />)],
  ['تقرير فواتير البيع', () => (<SalesInvoicesReportTab
    cur={{ code: 'SAR', symbol: 'ر.س', decimals: 2, name: 'ريال' }} companyName="متجر"
    initialFrom="2026-01-01" initialTo="2026-12-31"
  />)],
  ['إصلاح تاريخ العملة', () => (<FxHistoryRepair bookCode="SAR" bookDecimals={2} />)],
]

describe('دخان الشاشات: كل شاشة حرجة ترسم بلا انهيار', () => {
  for (const [label, element] of SCREENS) {
    it(`«${label}» ترسم نصاً حقيقياً بلا انهيار`, () => {
      seedStore()
      const { container } = mount(element())
      const text = container.textContent ?? ''
      expect(text.trim().length).toBeGreaterThan(40)
      /* حدود الخطأ تعرض عنواناً عاماً عند الانهيار — نرفضه صراحةً */
      expect(text).not.toContain('حدث خطأ غير متوقع')
    })
  }
})
