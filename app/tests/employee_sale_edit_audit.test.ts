import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeStock: true, allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], customers: [], employees: [], sales: [], saleReturns: [], employeeAdvances: [], advanceRepayments: [], journal: [] }) })
function fixture() {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  s.addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
  const state = useDataStore.getState(), customer = state.customers[0], employee = state.employees[0]
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const allocations = [{ accountCode: '1107', employeeId: employee.id, amountMinor: 500 }]
  const sale = s.postSale({ lines: [line], customerId: customer.id, payment: 'credit', paidMinor: 500, treasury: '1101', paymentAllocations: allocations, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
  const args = { saleId: sale.id, lines: [{ ...line, unitPriceMinor: 2500 }], customerId: customer.id, payment: 'credit' as const, paidMinor: 500, treasury: '1101' as const, paymentAllocations: allocations, invoiceDiscountPercent: 0, reason: 'تصحيح قيمة الخدمة', einvoiceActive: false, allowNegativeStock: true }
  return { s, employee, customer, sale, args }
}
it('يعدل الفاتورة مع تثبيت تحصيل الموظف وربط سجل السلفة بالقيد الجديد', () => {
  const { s, employee, sale, args } = fixture()
  const advance = useDataStore.getState().employeeAdvances[0]
  const edit = s.editSale(args)
  const state = useDataStore.getState()
  expect(state.employeeAdvances).toHaveLength(1)
  expect(state.employeeAdvances[0]).toMatchObject({ id: advance.id, employeeId: employee.id, amountMinor: 500, recoveredMinor: 0, journalEntryId: edit.journalEntryId })
  expect(s.getEmployeeAdvanceBalance(employee.id).remainingMinor).toBe(500)
  expect(state.journal.find(entry => entry.id === sale.journalEntryId)?.reversedByEntryId).toBeTruthy()
  expect(state.journal.find(entry => entry.id === edit.journalEntryId)?.lines.filter(line => line.accountCode === '1107').reduce((n, l) => n + l.debit - l.credit, 0)).toBe(500)
})
it('يحافظ على السداد الجزئي ولا يعيده أو يضاعف سلفة الموظف عند التعديل', () => {
  const { s, employee, args } = fixture()
  s.repayEmployeeAdvance({ employeeId: employee.id, amountMinor: 200, treasury: '1101' })
  const previous = useDataStore.getState().employeeAdvances[0]
  const edit = s.editSale(args)
  expect(useDataStore.getState().employeeAdvances[0]).toMatchObject({ id: previous.id, amountMinor: 500, recoveredMinor: 200, journalEntryId: edit.journalEntryId })
  expect(s.getEmployeeAdvanceBalance(employee.id).remainingMinor).toBe(300)
})
it('يحجب غياب سجل سلفة تحصيل الموظف بلا أي أثر', () => {
  const { s, args } = fixture()
  useRawDataStore.setState({ employeeAdvances: [] })
  const missing = useRawDataStore.getState()
  expect(() => s.editSale(args)).toThrow(/سلفة|موظف/)
  expect(useRawDataStore.getState().journal).toBe(missing.journal)
})
it('يسمح بتعديل ثانٍ مع سلسلة قيود موثقة، ويرفض قيداً أصلياً مكرراً', () => {
  const { s, args } = fixture()
  const first = s.editSale(args)
  const second = s.editSale({ ...args, lines: [{ ...args.lines[0], unitPriceMinor: 3000 }] })
  const advance = useDataStore.getState().employeeAdvances[0]
  expect(advance.journalEntryId).toBe(second.journalEntryId)
  expect(advance.saleCollectionEditHistory).toHaveLength(2)
  expect(advance.saleCollectionEditHistory?.[1].previousEntryId).toBe(first.journalEntryId)
  const state = useRawDataStore.getState()
  const entry = state.journal.find(row => row.id === second.journalEntryId)!
  useRawDataStore.setState({ journal: [...state.journal, entry] })
  const before = useRawDataStore.getState()
  expect(() => s.editSale(args)).toThrow(/قيد.*موظف/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يغير مبلغ تحصيل الموظف مع إبقاء السداد المثبت وتاريخ السلفة', () => {
  const { s, employee, args } = fixture()
  s.repayEmployeeAdvance({ employeeId: employee.id, amountMinor: 200, treasury: '1101' })
  const edit = s.editSale({ ...args, paidMinor: 700, paymentAllocations: [{ ...args.paymentAllocations[0], amountMinor: 700 }] })
  expect(s.getEmployeeAdvanceBalance(employee.id).remainingMinor).toBe(500)
  expect(useDataStore.getState().employeeAdvances[0]).toMatchObject({ amountMinor: 700, recoveredMinor: 200, journalEntryId: edit.journalEntryId })
  expect(() => s.editSale({ ...args, paidMinor: 100, paymentAllocations: [{ ...args.paymentAllocations[0], amountMinor: 100 }] })).toThrow(/المسترد|المستقطع/)
})
it('يستبدل موظف التحصيل غير المسترد بموظف آخر مع حفظ أثر الأصل', () => {
  const { s, employee, args } = fixture()
  s.addEmployee({ nameAr: 'موظف ثان', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
  const other = useDataStore.getState().employees.at(-1)!
  s.editSale({ ...args, paymentAllocations: [{ ...args.paymentAllocations[0], employeeId: other.id }] })
  expect(s.getEmployeeAdvanceBalance(employee.id).remainingMinor).toBe(0)
  expect(s.getEmployeeAdvanceBalance(other.id).remainingMinor).toBe(500)
  expect(useDataStore.getState().employeeAdvances).toHaveLength(2)
  expect(() => s.editSale({ ...args, paymentAllocations: [{ ...args.paymentAllocations[0], employeeId: other.id }] })).not.toThrow()
})
it('لا ينقل السداد الذي أجراه الموظف إلى موظف آخر دون تسوية مثبتة', () => {
  const { s, employee, args } = fixture()
  s.repayEmployeeAdvance({ employeeId: employee.id, amountMinor: 200, treasury: '1101' })
  s.addEmployee({ nameAr: 'موظف ثان', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
  const other = useDataStore.getState().employees.at(-1)!
  const before = useRawDataStore.getState()
  expect(() => s.editSale({ ...args, paymentAllocations: [{ ...args.paymentAllocations[0], employeeId: other.id }] })).toThrow(/المسترد|تسوية/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
