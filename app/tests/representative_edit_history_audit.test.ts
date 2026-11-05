import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { representativeSalesReport } from '../src/core/representativeSales.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, activeBranchContext: null, setup: { ...app.setup, countryCode: 'EG', allowNegativeStock: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, items: [], customers: [], employees: [], sales: [], saleReturns: [], journal: [] }) })
function fixture() {
 const s = useDataStore.getState()
 s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 s.addEmployee({ nameAr: 'المندوب', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const { customers, employees } = useDataStore.getState()
 const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
 const sale = s.postSale({ lines: [line], customerId: customers[0].id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, documentDate: '2000-01-01', salesRepEmployeeId: employees[0].id })
 const edited = s.editSale({ saleId: sale.id, lines: [{ ...line, unitPriceMinor: 3000 }], customerId: customers[0].id, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })
 return { s, sale, edited, employee: employees[0] }
}
it('يفصل البيع الأصلي عن عكسه وقيد التعديل بحسب تواريخها دون إعادة كتابة الماضي', () => {
 const { sale, edited, employee } = fixture(), state = useRawDataStore.getState()
 const old = representativeSalesReport(state.sales, state.saleReturns, state.journal, state.employees, { from: '2000-01-01', to: '2000-01-01' })
 expect(old.rows).toHaveLength(1)
 expect(old.rows[0]).toMatchObject({ kind: 'sale', representativeId: employee.id, amountMinor: 2000, document: sale.invoiceNumber })
 const day = edited.editHistory![0].at.slice(0, 10)
 const current = representativeSalesReport(state.sales, state.saleReturns, state.journal, state.employees, { from: day, to: day })
 expect(current.rows.map(row => [row.kind, row.amountMinor])).toEqual([['reversal', 2000], ['sale', 3000]])
 expect(current.salesMinor - current.returnsMinor - current.reversalsMinor).toBe(1000)
 expect(current.warnings).toEqual([])
})
it('يحجب السلسلة عند تلف قيد العكس ولا يختلق صافي الفترة', () => {
 const { edited } = fixture(), state = useRawDataStore.getState(), history = edited.editHistory![0]
 const journal = state.journal.map(entry => entry.id === history.reversalEntryId ? { ...entry, lines: entry.lines.map(line => ({ ...line, debit: line.debit * 2, credit: line.credit * 2 })) } : entry)
 const result = representativeSalesReport(state.sales, state.saleReturns, journal, state.employees, { from: '2000-01-01', to: '2100-01-01' })
 expect(result.rows).toEqual([])
 expect(result.warnings.join(' ')).toContain(edited.invoiceNumber)
})
it('ينسب المرتجع بعد التعديل لصاحب البيع المثبت في كامل سلسلة القيود', () => {
 const { s, edited, employee } = fixture()
 const ret = s.postSaleReturn({ saleId: edited.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'debt', reason: 'رد' })
 const state = useRawDataStore.getState()
 const result = representativeSalesReport(state.sales, state.saleReturns, state.journal, state.employees, { from: '2000-01-01', to: '2100-01-01' })
 expect(result.rows.find(row => row.document === ret.returnNumber)).toMatchObject({ kind: 'return', representativeId: employee.id, amountMinor: 3000 })
 expect(result.warnings).toEqual([])
})
it('يرتب عدة تعديلات في اليوم حسب أرقام القيود حتى لا يسبق العكس سببه', () => {
 const { s, edited } = fixture()
 s.editSale({ saleId: edited.id, lines: [{ ...edited.lines[0], unitPriceMinor: 3500 }], customerId: edited.customerId, payment: 'credit', paidMinor: 0, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح ثان', einvoiceActive: false })
 const state = useRawDataStore.getState(), day = state.sales[0].editHistory![0].at.slice(0, 10)
 const result = representativeSalesReport(state.sales, state.saleReturns, state.journal, state.employees, { from: day, to: day })
 expect(result.rows.map(row => [row.kind, row.amountMinor])).toEqual([['reversal', 2000], ['sale', 3000], ['reversal', 3000], ['sale', 3500]])
 expect(result.salesMinor - result.returnsMinor - result.reversalsMinor).toBe(1500)
})
it('يرفض تغيير المندوب في إحدى حلقات تاريخ القيد بدلاً من إعادة إسناد الماضي', () => {
 const { edited } = fixture(), state = useRawDataStore.getState()
 const journal = state.journal.map(entry => entry.id === edited.editHistory![0].previousEntryId ? { ...entry, saleRepresentativeId: null } : entry)
 const result = representativeSalesReport(state.sales, state.saleReturns, journal, state.employees, { from: '2000-01-01', to: '2100-01-01' })
 expect(result.rows).toEqual([])
 expect(result.warnings.join(' ')).toContain(edited.invoiceNumber)
})
it('يحجب الإجمالي عند تجاوز النطاق الآمن بدلاً من عرض مجموع مقرب', () => {
 const { sale } = fixture(), state = useRawDataStore.getState()
 const huge = Number.MAX_SAFE_INTEGER
 const synthetic = [1, 2].map(id => ({ ...sale, id, invoiceNumber: `S-${id}`, editHistory: [], journalEntryId: id, totals: { ...sale.totals, totalMinor: huge } }))
 const journal = synthetic.map(row => ({ id: row.id, entryNumber: row.id, date: row.date.slice(0, 10), description: '', sourceType: 'sale' as const, sourceId: row.id, saleRepresentativeId: row.salesRepEmployeeId, lines: [{ accountCode: '1104', debit: huge, credit: 0 }, { accountCode: '4101', debit: 0, credit: huge }], createdBy: '', createdAt: row.date, reversedByEntryId: null, reversesEntryId: null }))
 expect(() => representativeSalesReport(synthetic, [], journal, state.employees, { from: '2000-01-01', to: '2000-01-01' })).toThrow(/النطاق الآمن|مراجعة/)
})
