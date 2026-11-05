import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { saleEmployeeCustodyReport } from '../src/core/saleEmployeeCustodyReport.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, activeBranchContext: null, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true, allowNegativeStock: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, items: [], customers: [], employees: [], sales: [], journal: [], employeeAdvances: [], advanceRepayments: [] }) })
function fixture(documentDate?: string) {
 const s = useDataStore.getState()
 s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 for (const nameAr of ['مندوب البيع', 'حامل العهدة', 'حامل آخر']) s.addEmployee({ nameAr, phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const { customers, employees } = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 4000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
 const alloc = [{ accountCode: '1107', employeeId: employees[1].id, amountMinor: 500, note: 'عهدة أولى' }, { accountCode: '1107', employeeId: employees[2].id, amountMinor: 300, note: 'عهدة ثانية' }, { accountCode: '1101', amountMinor: 200 }]
 const sale = s.postSale({ lines: [line], customerId: customers[0].id, payment: 'credit', paidMinor: 1000, treasury: '1101', paymentAllocations: alloc, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, documentDate, salesRepEmployeeId: employees[0].id })
 return { s, sale, employees, line, alloc, customer: customers[0] }
}
const period = { from: '2000-01-01', to: '2100-01-01' }
const report = () => { const state = useRawDataStore.getState(); return saleEmployeeCustodyReport(state.sales, state.employeeAdvances, state.journal, state.employees, period) }
it('يعرض عهدتي الموظفين منفصلتين عن صاحب البيع والنقدية ولا يخصم الاسترداد من أصل الحركة', () => {
 const { s, employees, sale } = fixture()
 s.repayEmployeeAdvance({ employeeId: employees[1].id, amountMinor: 200, treasury: '1101' })
 const result = report()
 expect(result.rows.map(row => [row.employeeId, row.amountMinor])).toEqual([[employees[1].id, 500], [employees[2].id, 300]])
 expect(result.rows.every(row => row.document === sale.invoiceNumber)).toBe(true)
 expect(result.rows.some(row => row.employeeId === employees[0].id)).toBe(false)
 expect(result.warnings).toEqual([])
})
it('يستبعد الفاتورة بأكملها إن فقدت العهدة أو تعارضت مع التوزيع أو القيد', () => {
 const { sale } = fixture()
 useRawDataStore.setState(state => ({ employeeAdvances: state.employeeAdvances.slice(0, 1) }))
 expect(report().rows).toEqual([])
 expect(report().warnings.join(' ')).toContain(sale.invoiceNumber)
})
it('يظهر أصل العهدة وعكسه ثم العهدة البديلة في تاريخ قيودها', () => {
 const { s, sale, line, alloc, customer, employees } = fixture('2000-01-01')
 const edited = s.editSale({ saleId: sale.id, lines: [{ ...line, unitPriceMinor: 4500 }], customerId: customer.id, payment: 'credit', paidMinor: 1000, treasury: '1101', paymentAllocations: alloc, invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })
 const state = useRawDataStore.getState(), oldPeriod = { from: '2000-01-01', to: '2000-01-01' }, day = edited.editHistory![0].at.slice(0, 10)
 const old = saleEmployeeCustodyReport(state.sales, state.employeeAdvances, state.journal, state.employees, oldPeriod)
 expect(old.rows.map(row => [row.kind, row.employeeId, row.amountMinor])).toEqual([['allocation', employees[1].id, 500], ['allocation', employees[2].id, 300]])
 const current = saleEmployeeCustodyReport(state.sales, state.employeeAdvances, state.journal, state.employees, { from: day, to: day })
 expect(current.rows.map(row => [row.kind, row.employeeId, row.amountMinor])).toEqual([['reversal', employees[1].id, 500], ['reversal', employees[2].id, 300], ['allocation', employees[1].id, 500], ['allocation', employees[2].id, 300]])
 expect(current.warnings).toEqual([])
})
it('يُظهر استبدال حامل العهدة حسب السجل المثبت دون إسناد الأصل للحامل الجديد', () => {
 const { s, sale, line, alloc, customer, employees } = fixture()
 const replacement = [{ ...alloc[0], employeeId: employees[0].id }, alloc[1], alloc[2]]
 s.editSale({ saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 1000, treasury: '1101', paymentAllocations: replacement, invoiceDiscountPercent: 0, reason: 'تغيير', einvoiceActive: false })
 const result = report()
 expect(result.rows.filter(row => row.kind === 'reversal').map(row => row.employeeId)).toEqual([employees[1].id, employees[2].id])
 expect(result.rows.filter(row => row.kind === 'allocation').map(row => row.employeeId)).toEqual([employees[1].id, employees[2].id, employees[0].id, employees[2].id])
 expect(result.warnings).toEqual([])
})
it('يستبعد التاريخ كاملاً إذا تغيرت مقادير سلسلة عهدة الموظف', () => {
 const { s, sale, line, alloc, customer } = fixture()
 s.editSale({ saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 1000, treasury: '1101', paymentAllocations: alloc, invoiceDiscountPercent: 0, reason: 'تغيير', einvoiceActive: false })
 useRawDataStore.setState(state => ({ employeeAdvances: state.employeeAdvances.map((row, i) => i === 0 ? { ...row, saleCollectionEditHistory: [{ ...row.saleCollectionEditHistory![0], previousAmountMinor: 600 }] } : row) }))
 expect(report().rows).toEqual([])
 expect(report().warnings.join(' ')).toContain(sale.invoiceNumber)
})
it('يرفض تبديل حامل العهدة حتى لو عُدّلت الفاتورة وسجل العهدة معاً', () => {
 const { sale, employees } = fixture()
 useRawDataStore.setState(state => ({
  sales: state.sales.map(row => row.id === sale.id ? { ...row, paymentAllocations: row.paymentAllocations!.map(payment => payment.employeeId === employees[1].id ? { ...payment, employeeId: employees[0].id } : payment) } : row),
  employeeAdvances: state.employeeAdvances.map(row => row.employeeId === employees[1].id ? { ...row, employeeId: employees[0].id } : row),
 }))
 expect(report().rows).toEqual([])
 expect(report().warnings.join(' ')).toContain(sale.invoiceNumber)
})
it('يتتبع تغيير الموظف وإعادته مجدداً في قيد لاحق بلا خلط السجلات المتقاعدة', () => {
 const { s, sale, line, alloc, customer, employees } = fixture()
 const edit = { saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit' as const, paidMinor: 1000, treasury: '1101' as const, invoiceDiscountPercent: 0, reason: 'تغيير', einvoiceActive: false }
 s.editSale({ ...edit, paymentAllocations: [{ ...alloc[0], employeeId: employees[0].id }, alloc[1], alloc[2]] })
 s.editSale({ ...edit, paymentAllocations: alloc })
 const result = report()
 expect(result.warnings).toEqual([])
 expect(result.rows).toHaveLength(10)
 expect(result.rows.filter(row => row.kind === 'allocation').map(row => row.employeeId)).toEqual([employees[1].id, employees[2].id, employees[0].id, employees[2].id, employees[1].id, employees[2].id])
})
it('يرفض تعديل الفاتورة عند حذف توزيع العهدة وسجلاتها مع بقاء ختم القيد', () => {
 const { s, sale, line, customer } = fixture()
 useRawDataStore.setState(state => ({ sales: state.sales.map(row => row.id === sale.id ? { ...row, paymentAllocations: [{ accountCode: '1101', amountMinor: 1000 }] } : row), employeeAdvances: [] }))
 const before = useRawDataStore.getState()
 expect(() => s.editSale({ saleId: sale.id, lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 1000, treasury: '1101', paymentAllocations: [{ accountCode: '1101', amountMinor: 1000 }], invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })).toThrow(/عهدة|موظف/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
