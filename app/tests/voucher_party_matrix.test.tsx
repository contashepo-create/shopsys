import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'
import { statementBalance } from '../src/core/statements.ts'

/**
 * §102 (مراجعة المالك — «السندات يجب أن ترتبط بأطرافها وكل شيء»): مصفوفة
 * سندات القبض/الصرف × الأطراف والمراكز — دليل واحد يجزم أن كل مسار:
 *   · يرتبط بطرفه (عميل/مورد/موظف) أو يُرفض صريحاً
 *   · يخفض/يرفع رصيد الطرف في كشفه بالضبط
 *   · يربط المشروع (§95) والمركبة والعهدة بلا خلل في القيد المزدوج
 * الحارس القائم: 1104 بلا عميل و2101 بلا مورد مرفوضان برسالة صريحة.
 */

const original = useDataStore.getState()
const customer = { id: 701, nameAr: 'عميل المصفوفة', phone: '', creditLimitMinor: 0, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const supplier = { id: 702, nameAr: 'مورد المصفوفة', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const employee = { id: 703, nameAr: 'موظف المصفوفة', phone: '', jobTitle: 'سائق', salaryMinor: 5_000, hireDate: '2026-01-01', notes: '', nationalId: '', bankAccount: '' }
const employee2 = { ...employee, id: 704, nameAr: 'موظف ثانٍ' }
const project = { id: 31, code: 'PRJ-031', nameAr: 'مشروع المصفوفة', clientId: customer.id, status: 'active' as const }

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  useDataStore.setState({
    ...original,
    customers: [customer] as never,
    suppliers: [supplier] as never,
    employees: [employee, employee2] as never,
    projects: [project] as never,
    projectExtracts: [
      { id: 51, extractNumber: 'EXT-0051', date: '2026-09-10', projectId: project.id, payment: 'credit', isFinal: false, totals: { grossMinor: 800, vatMinor: 0, retentionMinor: 80, dueMinor: 720 } },
    ] as never,
    sales: [
      { id: 1, invoiceNumber: 'SAL-0001', date: '2026-09-20', customerId: customer.id, payment: 'credit', paidMinor: 0, totals: { totalMinor: 1_000 } },
    ] as never,
    purchases: [
      { id: 11, invoiceNumber: 'PUR-0011', date: '2026-09-20', supplierId: supplier.id, grandTotalMinor: 1_200, supplierDueMinor: 1_200, paidMinor: 0 },
    ] as never,
    payrollSlips: [
      { id: 91, slipNumber: 'PS-0091', runId: 1, month: '2026-09', employeeId: employee.id, employeeName: employee.nameAr, grossMinor: 5_000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0, netMinor: 5_000, status: 'accrued', accruedAt: '2026-09-28T10:00:00', paidAt: null, paidEntryId: null, paidFrom: null } as never,
      { id: 92, slipNumber: 'PS-0092', runId: 1, month: '2026-09', employeeId: employee2.id, employeeName: employee2.nameAr, grossMinor: 4_000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0, netMinor: 4_000, status: 'accrued', accruedAt: '2026-09-28T10:00:00', paidAt: null, paidEntryId: null, paidFrom: null } as never,
    ],
    vehicles: [{ id: 44, plateNumber: 'مصفوفة 44', model: '', kind: 'truck', status: 'active' }] as never,
    custodyFiles: [{ id: 61, fileNumber: 'عهدة-2026-0061', employeeId: employee.id, projectId: project.id, reason: 'عهدة موقع', notes: '', openedAt: '2026-09-01', status: 'open', settledAt: null, returnedMinor: 0, shortageMinor: 0, settleTreasury: null }] as never,
    custodyTxs: [
      { id: 81, fileId: 61, type: 'fund' as const, date: '2026-09-01', amountMinor: 500, excessMinor: 0, description: 'تعزيز افتتاحي', treasury: '1101', projectId: null, purchaseId: null, journalEntryId: 900 },
    ] as never,
    saleReturns: [], purchaseReturns: [],
    vouchers: [], clientSettlements: [], journal: [],
    vehicleCostEntries: [], projectCosts: [],
    treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 100_000, isDefault: true }] as never,
  })
})

describe('مصفوفة سندات القبض/الصرف × الأطراف والمراكز (§102)', () => {
  it('قبض عميل 1104: يطفئ المستخلص الآجل FIFO ثم الفائض تحت الحساب — ورصيد كشفه ينزل بالضبط', () => {
    const voucher = useDataStore.getState().postVoucher({
      kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 900,
      description: 'تحصيل دفعة', partyKind: 'customer', partyId: customer.id, projectId: project.id,
    })
    /* FIFO: المستخلص الأقدم (2026-09-10) قبل فاتورة البيع (2026-09-20) */
    expect(voucher.allocations).toEqual([
      { docKey: 'extract:51', docLabel: 'مستخلص EXT-0051', appliedMinor: 720 },
      { docKey: 'sale:1', docLabel: 'فاتورة SAL-0001', appliedMinor: 180 },
    ])
    expect(voucher.unallocatedMinor).toBe(0)
    expect(voucher.projectId).toBe(project.id)
    /* كشف العميل: 1,720 ذمة أصلية (720 مستخلص + 1,000 فاتورة) − 900 محصل = 820 */
    const rows = useDataStore.getState().getCustomerStatementRows(customer.id)
    expect(statementBalance(rows)).toBe(820)
  })

  it('الحارس القائم: 1104 بلا عميل و2101 بلا مورد مرفوضان — لا سند يفك دفتر الطرف عن الدفتر العام', () => {
    expect(() => useDataStore.getState().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 100, description: 'بلا طرف' }))
      .toThrow(/يتطلب اختيار عميل مسجل/)
    expect(() => useDataStore.getState().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 100, description: 'بلا طرف' }))
      .toThrow(/يتطلب اختيار مورد مسجل/)
    /* لا قيد تسرب لأي من الرفضين */
    expect(useDataStore.getState().journal.filter((e) => e.sourceType === 'payment_voucher')).toHaveLength(0)
  })

  it('صرف مورد 2101: يطفئ فاتورة الشراء FIFO ويرفع ما فاض تحت الحساب — ورصيد كشفه ينزل بالضبط', () => {
    const voucher = useDataStore.getState().postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 1_000,
      description: 'سداد دفعة', partyKind: 'supplier', partyId: supplier.id,
    })
    expect(voucher.allocations).toEqual([{ docKey: 'purchase:11', docLabel: 'فاتورة شراء PUR-0011', appliedMinor: 1_000 }])
    expect(voucher.unallocatedMinor).toBe(0)
    const rows = useDataStore.getState().getSupplierStatementRows(supplier.id)
    expect(statementBalance(rows)).toBe(200) /* 1,200 − 1,000 */
  })

  it('صرف رواتب 2104 بقسائم محددة: تُوسم مصروفة بسندها ولا تُسدد مرتين ولا قسيمة لموظف آخر', () => {
    const store = useDataStore.getState()
    const voucher = store.postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 5_000,
      description: 'صرف راتب سبتمبر', partyKind: 'employee', partyId: employee.id, settleSlipIds: [91],
    })
    const paid = useDataStore.getState().payrollSlips.find((s) => s.id === 91)!
    expect(paid).toMatchObject({ status: 'paid' })
    expect(paid.paidEntryId).toBeTruthy()
    expect(paid.paidFrom).toContain('سند صرف')
    expect(useDataStore.getState().payrollSlips.find((s) => s.id === 92)?.status).toBe('accrued')
    /* قسيمة موظف آخر على سند هذا الموظف مرفوضة */
    expect(() => useDataStore.getState().postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 4_000,
      description: 'خطأ توجيه', partyKind: 'employee', partyId: employee.id, settleSlipIds: [92],
    })).toThrow(/ليست لهذا الموظف/)
    /* لا تسديد مزدوج */
    expect(() => useDataStore.getState().postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 5_000,
      description: 'تكرار', partyKind: 'employee', partyId: employee.id, settleSlipIds: [91],
    })).toThrow(/مصروفة بالفعل/)
  })

  it('قبض موظف 1107 (استرداد سلفة/تسوية): يسجل في كشفه دائناً — يسدد دين سلفته', () => {
    useDataStore.getState().postVoucher({
      kind: 'receipt', treasury: '1101', counterAccountCode: '1107', amountMinor: 300,
      description: 'تسوية نقدية من الموظف', partyKind: 'employee', partyId: employee.id,
    })
    const rows = useDataStore.getState().getEmployeeStatementRows(employee.id)
    expect(rows.some((r) => r.description.includes('تسوية نقدية من الموظف') && r.creditMinor === 300)).toBe(true)
  })

  it('سند صرف على مركبة الأسطول: حركة تكلفة مركبة تُنشأ بتصنيفها — والمركبة مع القبض مرفوضة', () => {
    useDataStore.getState().postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '5102', amountMinor: 250,
      description: 'وقود', vehicleId: 44, vehicleCostCategory: 'fuel',
    })
    expect(useDataStore.getState().vehicleCostEntries).toMatchObject([
      { vehicleId: 44, kind: 'cost', category: 'fuel', amountMinor: 250 },
    ])
    expect(() => useDataStore.getState().postVoucher({
      kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 50, description: 'خطأ',
      partyKind: 'customer', partyId: customer.id, vehicleId: 44,
    })).toThrow(/متاح لسندات الصرف فقط/)
  })

  it('مصروف من عهدة موظف على مشروع: بند تكلفة مشروع (5110) يُنشأ ويربط العهدة بالمشروع والموظف', () => {
    const tx = useDataStore.getState().postCustodyExpense({ fileId: 61, amountMinor: 200, description: 'نثريات موقع' })
    expect(tx.projectId).toBe(project.id)
    const costs = useDataStore.getState().projectCosts
    expect(costs).toHaveLength(1)
    expect(costs[0]).toMatchObject({ projectId: project.id, kind: 'other', amountMinor: 200 })
    const entry = useDataStore.getState().journal.find((e) => e.id === tx.journalEntryId)
    expect(entry?.lines.some((l) => l.accountCode === '5110')).toBe(true)
  })

  it('توازن القيد المزدوج: كل قيود السندات في المصفوفة متوازنة ذَمّة=ائتمان', () => {
    const store = useDataStore.getState()
    store.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 900, description: 'تحصيل', partyKind: 'customer', partyId: customer.id, projectId: project.id })
    store.postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 1_000, description: 'سداد', partyKind: 'supplier', partyId: supplier.id })
    store.postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2104', amountMinor: 5_000, description: 'رواتب', partyKind: 'employee', partyId: employee.id, settleSlipIds: [91] })
    store.postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5102', amountMinor: 250, description: 'وقود', vehicleId: 44, vehicleCostCategory: 'fuel' })
    store.postCustodyExpense({ fileId: 61, amountMinor: 200, description: 'نثريات موقع' })
    for (const entry of useDataStore.getState().journal) {
      const debit = entry.lines.reduce((a, l) => a + l.debitMinor, 0)
      const credit = entry.lines.reduce((a, l) => a + l.creditMinor, 0)
      expect(debit, `القيد ${entry.entryNumber} غير متوازن`).toBe(credit)
    }
  })
})
