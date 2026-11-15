import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, activeBranchContext: null, setup: { ...app.setup, countryCode: 'EG', allowNegativeStock: true, allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, items: [], customers: [], employees: [], sales: [], journal: [], staffCommissions: [] }) })
function fixture() {
 const s = useDataStore.getState()
 s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 s.addEmployee({ nameAr: 'المندوب', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 s.addEmployee({ nameAr: 'موظف العمولة', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const { customer, representative, commission } = { customer: useDataStore.getState().customers[0], representative: useDataStore.getState().employees[0], commission: useDataStore.getState().employees[1] }
 const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const lines = [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }]
 const args = { lines, customerId: customer.id, payment: 'credit' as const, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false }
 return { s, customer, representative, commission, lines, args }
}
it('يحفظ المندوب منفصلاً عن مستحق العمولة على الفاتورة والقيد', () => {
 const { s, representative, commission, args } = fixture()
 const sale = s.postSale({ ...args, salesRepEmployeeId: representative.id, staffCommission: { employeeId: commission.id, amountMinor: 100 } })
 expect(sale.salesRepEmployeeId).toBe(representative.id)
 expect(useRawDataStore.getState().journal.find(e => e.id === sale.journalEntryId)?.saleRepresentativeId).toBe(representative.id)
 expect(useRawDataStore.getState().staffCommissions[0].employeeId).toBe(commission.id)
})
it('يرفض مندوباً غير نشط أو مكرراً قبل أي قيد', () => {
 const { s, representative, args } = fixture()
 useRawDataStore.setState(state => ({ employees: state.employees.map(e => e.id === representative.id ? { ...e, active: false } : e) }))
 const before = useRawDataStore.getState()
 expect(() => s.postSale({ ...args, salesRepEmployeeId: representative.id })).toThrow(/مندوب/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 useRawDataStore.setState(state => ({ employees: [...state.employees.map(e => ({ ...e, active: true })), representative] }))
 expect(() => s.postSale({ ...args, salesRepEmployeeId: representative.id })).toThrow(/مندوب/)
})
it('يحافظ التعديل على إثبات المندوب ويرفض تعارض الفاتورة مع القيد', () => {
 const { s, representative, customer, lines, args } = fixture()
 const sale = s.postSale({ ...args, salesRepEmployeeId: representative.id })
 const edit = { saleId: sale.id, lines, customerId: customer.id, payment: 'credit' as const, paidMinor: 0, treasury: '1101' as const, invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false }
 const updated = s.editSale(edit)
 expect(updated.salesRepEmployeeId).toBe(representative.id)
 expect(useRawDataStore.getState().journal.find(e => e.id === updated.journalEntryId)?.saleRepresentativeId).toBe(representative.id)
 useRawDataStore.setState(state => ({ sales: state.sales.map(row => row.id === sale.id ? { ...row, salesRepEmployeeId: null } : row) }))
 const before = useRawDataStore.getState()
 expect(() => s.editSale(edit)).toThrow(/مندوب/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يُظهر التقرير الفترة والمرتجع للمندوب المثبت فقط ويُبقي القديم غير محدد', async () => {
 const { representativeSalesReport } = await import('../src/core/representativeSales.ts')
 const { s, representative, args } = fixture()
 const sale = s.postSale({ ...args, salesRepEmployeeId: representative.id })
 const old = s.postSale({ ...args })
 const ret = s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'credit', reason: 'رد' })
 const state = useRawDataStore.getState(), day = sale.date.slice(0, 10)
 const result = representativeSalesReport(state.sales, state.saleReturns, state.journal, state.employees, { from: day, to: day })
 expect(result.salesMinor).toBe(4000)
 expect(result.returnsMinor).toBe(2000)
 expect(result.rows.find(row => row.document === ret.returnNumber)?.representativeId).toBe(representative.id)
 expect(result.rows.find(row => row.document === old.invoiceNumber)?.representativeId).toBeNull()
 expect(result.warnings).toEqual([])
})
it('لا ينسب التقرير فاتورة بتعارض إثبات القيد ويعرض سبب استبعادها', async () => {
 const { representativeSalesReport } = await import('../src/core/representativeSales.ts')
 const { s, representative, args } = fixture()
 const sale = s.postSale({ ...args, salesRepEmployeeId: representative.id })
 useRawDataStore.setState(state => ({ journal: state.journal.map(entry => entry.id === sale.journalEntryId ? { ...entry, saleRepresentativeId: null } : entry) }))
 const state = useRawDataStore.getState(), day = sale.date.slice(0, 10)
 const result = representativeSalesReport(state.sales, state.saleReturns, state.journal, state.employees, { from: day, to: day })
 expect(result.rows).toHaveLength(0)
 expect(result.warnings.join(' ')).toContain(sale.invoiceNumber)
})
it('يختم أصل المرتجع ومندوب البيع المستقل ويرفض مرجعاً محوّراً', async () => {
 const { representativeSalesReport } = await import('../src/core/representativeSales.ts')
 const { s, representative, commission, args } = fixture()
 const first = s.postSale({ ...args, salesRepEmployeeId: representative.id })
 const second = s.postSale({ ...args, salesRepEmployeeId: commission.id })
 const ret = s.postSaleReturn({ saleId: first.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'credit', reason: 'رد' })
 const state = useRawDataStore.getState()
 expect(state.journal.find(entry => entry.id === ret.journalEntryId)).toMatchObject({ saleReturnOriginalSaleId: first.id, saleReturnRepresentativeId: representative.id })
 const corrupted = state.saleReturns.map(row => row.id === ret.id ? { ...row, saleId: second.id } : row)
 const result = representativeSalesReport(state.sales, corrupted, state.journal, state.employees, { from: '2000-01-01', to: '2100-01-01' })
 expect(result.rows.some(row => row.document === ret.returnNumber)).toBe(false)
 expect(result.warnings.join(' ')).toContain(ret.returnNumber)
})
it('يرفض ترحيل المرتجع إذا لم يطابق مندوب الأصل ختم قيده', () => {
 const { s, representative, args } = fixture()
 const sale = s.postSale({ ...args, salesRepEmployeeId: representative.id })
 useRawDataStore.setState(state => ({ sales: state.sales.map(row => row.id === sale.id ? { ...row, salesRepEmployeeId: null } : row) }))
 const before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'credit', reason: 'رد' })).toThrow(/مندوب/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
