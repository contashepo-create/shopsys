import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { AnalyticalProjectReportView } from '../src/ui/contracting/AnalyticalProjectReportView.tsx'
import { useDataStore, EMPTY_EXTENDED, type DataState } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { getCountry } from '../src/core/countries.ts'
import { formatMinor } from '../src/core/money.ts'

const original = useDataStore.getState()
const appOriginal = useAppStore.getState()
beforeEach(() => {
  useDataStore.setState({ ...original, customers: [], projects: [], projectExtracts: [], projectCosts: [], purchases: [], purchaseReturns: [], journal: [] })
  useAppStore.setState({ ...appOriginal, setup: { ...appOriginal.setup, countryCode: 'EG', vatPercent: 0, allowNegativeTreasury: true } })
})
afterEach(() => { cleanup(); useDataStore.setState(original); useAppStore.setState(appOriginal) })

it('سجل مرتجع افتراضي/مستورد يُعرض في التقرير ويتحدث عند إضافته', () => {
  const store = useDataStore.getState()
  store.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectCost({ projectId: project.id, kind: 'materials', amountMinor: 1000, payment: 'cash', description: 'مواد', treasury: '1101' })
  const currency = getCountry('EG')!.currency
  const total = () => screen.getAllByText('إجمالي المصروفات')[0].parentElement?.textContent
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(total()).toContain(formatMinor(1000, currency, false))
  act(() => useDataStore.setState({
    purchases: [{ id: 999, projectId: project.id }] as DataState['purchases'],
    purchaseReturns: [{ purchaseId: 999, returnNumber: 'R-1', totalMinor: 300, date: '2026-01-03' }] as DataState['purchaseReturns'],
  }))
  expect(total()).toContain(formatMinor(700, currency, false))
  expect(screen.getByText('مرتجع مشتريات المشروع')).toBeTruthy()
})


it('لا يُضاف سند موزّع خطأً على مستخلص نقدي كتحصيل ثانٍ', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع نقدي', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'نقدي', grossMinor: 1000, vatPercent: 0, payment: 'cash' })
  useDataStore.setState({ vouchers: [{ kind: 'receipt', partyKind: 'customer', partyId: customer.id, date: '2026-01-01', voucherNumber: 'WRONG', amountMinor: 500, allocations: [{ docKey: `extract:${extract.id}`, appliedMinor: 500 }] }] as DataState['vouchers'] })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.queryByText('WRONG')).toBeNull()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})


it('ترحيل مرتجع مخزني لفاتورة مربوطة بمشروع مرفوض في المسار الحالي', () => {
  useDataStore.setState({ purchases: [{ id: 999, projectId: 1 }] as DataState['purchases'] })
  expect(() => useDataStore.getState().postPurchaseReturn({ purchaseId: 999, qtyByItem: new Map(), refund: 'cash', reason: 'اختبار', __approvalBypass: true } as never))
    .toThrow('فاتورة مشروع مقاولات')
})
