import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, type SaleInvoice } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useDataStore.getState()
const app = useAppStore.getState()
const args = (customerId: number, saleId: number | null, totalMinor = 10000) => ({ customerId, saleId, totalMinor, downPaymentMinor: 0, count: 2, intervalMonths: 1, firstDueDate: '2026-12-01', treasury: '1101', notes: '' })

beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...initial, customers: [], sales: [], saleReturns: [], installmentPlans: [], journal: [], vouchers: [], clientSettlements: [], openingBalances: {}, cheques: [] })
})

describe('ربط خطة التقسيط بفاتورة بيع', () => {
  it('يرفض الفاتورة المفقودة أو لعميل آخر بلا قيد، ويقبل الفاتورة الصحيحة ثم يمنع التكرار', () => {
    const s = useDataStore.getState()
    s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'أول', phone: '', creditLimitMinor: 0, notes: '' })
    s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'ثان', phone: '', creditLimitMinor: 0, notes: '' })
    const [a, b] = useDataStore.getState().customers
    s.setOpeningBalance({ kind: 'customer', refId: a.id, amountMinor: 20000, label: a.nameAr })
    useDataStore.setState({ sales: [{ id: 11, customerId: b.id, invoiceNumber: 'B', date: '2026-01-01', payment: 'credit', totals: { totalMinor: 10000 } }, { id: 12, customerId: a.id, invoiceNumber: 'A', date: '2026-01-01', payment: 'credit', totals: { totalMinor: 10000 } }] as SaleInvoice[] })
    const journalCount = useDataStore.getState().journal.length
    expect(() => s.createInstallmentPlan(args(a.id, 999))).toThrow(/غير موجودة/)
    expect(() => s.createInstallmentPlan(args(a.id, 11))).toThrow(/لا تخص العميل/)
    expect(() => s.createInstallmentPlan(args(a.id, 12, 11000))).toThrow(/المتبقي على فاتورة/)
    expect(useDataStore.getState().journal).toHaveLength(journalCount)
    expect(s.createInstallmentPlan(args(a.id, 12)).saleId).toBe(12)
    expect(() => s.createInstallmentPlan(args(a.id, 12))).toThrow(/بالفعل/)
  })
})
