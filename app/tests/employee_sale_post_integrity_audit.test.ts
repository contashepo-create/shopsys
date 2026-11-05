import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, activeBranchContext: null, setup: { ...app.setup, countryCode: 'EG', allowNegativeStock: true, allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, items: [], customers: [], employees: [], sales: [], employeeAdvances: [], staffCommissions: [], journal: [] })
})
function fixture() {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  s.addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
  const state = useRawDataStore.getState(), customer = state.customers[0], employee = state.employees[0]
  const itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
  const line = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
  const args = { lines: [line], customerId: customer.id, payment: 'credit' as const, treasury: '1101' as const, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false }
  return { s, employee, args }
}
it('يرفض تحصيل الموظف مكرراً ولو اختلفت ملاحظات سطور القيد', () => {
  const { s, employee, args } = fixture(), before = useRawDataStore.getState()
  expect(() => s.postSale({ ...args, paymentAllocations: [{ accountCode: '1107', employeeId: employee.id, amountMinor: 200, note: 'أ' }, { accountCode: '1107', employeeId: employee.id, amountMinor: 300, note: 'ب' }] })).toThrow(/موظف.*مكرر|مكرر.*موظف/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().employeeAdvances).toBe(before.employeeAdvances)
})
it('يرفض تسجيل موظف على وسيلة خزينة لا تحمل حساب عهدة الموظفين', () => {
  const { s, employee, args } = fixture(), before = useRawDataStore.getState()
  expect(() => s.postSale({ ...args, paymentAllocations: [{ accountCode: '1101', employeeId: employee.id, amountMinor: 200 }] })).toThrow(/موظف/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض مزج ذمة طرف غير العميل مع تحصيل الموظف غير القابل للمطابقة لاحقاً', () => {
  const { s, employee, args } = fixture(), before = useRawDataStore.getState()
  expect(() => s.postSale({ ...args, customerId: null, partyKind: 'employee', partyId: employee.id, paymentAllocations: [{ accountCode: '1107', employeeId: employee.id, amountMinor: 200 }] })).toThrow(/موظف|طرف/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يحمل التحصيل أو العمولة موظفاً خارج الفرع', () => {
  const { s, employee, args } = fixture()
  useRawDataStore.setState(state => ({
    branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true, customModulesMode: 'all', enabledModules: [] }, { id: 2, nameAr: 'آخر', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true, customModulesMode: 'all', enabledModules: [] }] as never,
    activeBranchId: 1,
    employees: state.employees.map(row => ({ ...row, branchId: 2 })),
    warehouses: [{ id: 1, nameAr: 'رئيسي', code: 'MAIN', isMain: true }, { id: 2, nameAr: 'آخر', code: 'SECOND', isMain: false }] as never,
  }))
  const before = useRawDataStore.getState()
  expect(() => s.postSale({ ...args, paymentAllocations: [{ accountCode: '1107', employeeId: employee.id, amountMinor: 200 }] })).toThrow(/موظف.*فرع|فرع.*موظف/)
  expect(() => s.postSale({ ...args, staffCommission: { employeeId: employee.id, amountMinor: 100 } })).toThrow(/موظف.*فرع|فرع.*موظف/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يقبل موظفين مكررين في بيانات الشركة ولو كان أحدهما ضمن الفرع', () => {
  const { s, employee, args } = fixture()
  useRawDataStore.setState(state => ({ employees: [...state.employees, { ...employee, nameAr: 'نسخة أخرى' }] }))
  const before = useRawDataStore.getState()
  expect(() => s.postSale({ ...args, paymentAllocations: [{ accountCode: '1107', employeeId: employee.id, amountMinor: 200 }] })).toThrow(/موظف/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يُنشئ تحصيل موظفين مختلفين بسجلات مستقلة قابلة للمطابقة عند تعديل الفاتورة', () => {
  const { s, employee, args } = fixture()
  s.addEmployee({ nameAr: 'ثان', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
  const other = useRawDataStore.getState().employees.at(-1)!
  const allocations = [{ accountCode: '1107', employeeId: employee.id, amountMinor: 200, note: 'أ' }, { accountCode: '1107', employeeId: other.id, amountMinor: 300, note: 'ب' }]
  const sale = s.postSale({ ...args, paymentAllocations: allocations })
  expect(useRawDataStore.getState().employeeAdvances.map(row => [row.employeeId, row.amountMinor])).toEqual([[employee.id, 200], [other.id, 300]])
  expect(() => s.editSale({ saleId: sale.id, lines: args.lines, customerId: args.customerId, payment: args.payment, paidMinor: 500, treasury: args.treasury, paymentAllocations: allocations, invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })).not.toThrow()
})
it('يرفض مبلغ عمولة سالباً أو غير آمن بدلاً من إسقاطه بصمت', () => {
  const { s, employee, args } = fixture(), before = useRawDataStore.getState()
  for (const amountMinor of [-1, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => s.postSale({ ...args, staffCommission: { employeeId: employee.id, amountMinor } })).toThrow(/عمولة/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().staffCommissions).toBe(before.staffCommissions)
})
it('يرفض حساب تحصيل مكرراً حتى لو وجد في دليل الخزائن', () => {
  const { s, args } = fixture()
  useRawDataStore.setState(state => ({ treasuries: [...state.treasuries, { ...state.treasuries.find(row => row.code === '1101')! }] }))
  const before = useRawDataStore.getState()
  expect(() => s.postSale({ ...args, payment: 'cash' })).toThrow(/تحصيل.*فريد/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
