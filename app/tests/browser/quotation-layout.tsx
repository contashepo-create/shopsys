import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../src/index.css'

// عزل الاختبار عن بيانات المتصفح الفعلية، ورفض تشغيله في بيئة جسر سطح المكتب.
async function main() {
  if ('shopsysDesktop' in window) throw new Error('اختبار التصميم للمتصفح المعزول فقط')
  const memory = new Map<string, string>()
  Storage.prototype.getItem = function (key) { return memory.get(key) ?? null }
  Storage.prototype.setItem = function (key, value) { memory.set(key, String(value)) }
  Storage.prototype.removeItem = function (key) { memory.delete(key) }
  Storage.prototype.clear = function () { memory.clear() }
  const [{ QuotationsPage }, { AdvancedSalesInvoicePage }, { ToastHost }, { EMPTY_EXTENDED, useRawDataStore }, { useAppStore }] = await Promise.all([
    import('../../src/ui/pages/QuotationsPage.tsx'), import('../../src/ui/pages/AdvancedSalesInvoicePage.tsx'), import('../../src/ui/components/ui.tsx'), import('../../src/data/repo.ts'), import('../../src/stores/app.store.ts'),
  ])
  const state = useAppStore.getState()
  const setup = { ...state.setup, completed: true, countryCode: 'SA', activityId: 'contracting' as const, modules: ['contracting', 'inventory', 'purchases'] as typeof state.setup.modules, vatPercent: 15, taxRegistrationStatus: 'registered' as const }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ branches: [], activeBranchId: null, currentUserId: null, customers: [{ ...EMPTY_EXTENDED, id: 1, nameAr: 'عميل تجريبي', phone: '', creditLimitMinor: 0, notes: '' }], quotations: [{ id: 1, quoteNumber: 'QT-0001', kind: 'quotation', clientName: 'عميل تجريبي', clientId: 1, titleAr: 'عرض محفوظ', date: '2026-01-01', validUntil: '2099-01-01', status: 'draft', lines: [{ nameAr: 'أعمال', descriptionAr: 'بند محفوظ', qty: 1, unitAr: 'عدد', unitPriceMinor: 10000, estCostMinor: 0, vatPercent: 15 }], notes: '', projectId: null, winProbability: 50, bidBondMinor: 0 }], advancedInvoiceDrafts: [] })
  const sale = new URLSearchParams(location.search).get('view') === 'sale'
  createRoot(document.getElementById('root')!).render(<MemoryRouter>{sale ? <AdvancedSalesInvoicePage /> : <QuotationsPage />}<ToastHost /></MemoryRouter>)
}
void main()
