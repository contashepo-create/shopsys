/**
 * بلاغ المالك: الصرف الجزئي للراتب المستحق وسلفة الاستقطاع التلقائية.
 *
 * المثال الذي وصفه المالك: استحقاق 4000 ⇒ سلفة مستقطعة 1000 ⇒ الصافي 3000 ⇒ سند صرف 1000
 * ⇒ عند سند صرف جديد لباقي الاستحقاق يظهر المتبقي 2000 فقط لا 4000 ولا 3000.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { defaultAdvanceRecovery, allocateSlipPayments, slipRemainingMinor, slipsTotals } = await import('../src/core/payrollSlips.ts')

const S = () => useDataStore.getState()
const original = useDataStore.getState()

function ledgerBalance(code: string): number {
  let bal = 0
  for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) bal += l.credit - l.debit
  return bal
}
function statementBalance(employeeId: number): number {
  return S().getEmployeeStatementRows(employeeId).reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0)
}
function newEmployee(name: string, salaryMinor: number): number {
  S().addEmployee({ nameAr: name, phone: '', roleId: 'cashier', salaryMinor, active: true } as never)
  return S().employees.find((e) => e.nameAr === name)!.id
}

beforeEach(() => {
  useDataStore.setState(original)
  useAppStore.setState((s) => ({
    setup: { ...s.setup, completed: true, activityId: 'supermarket', countryCode: 'EG', taxRegistrationStatus: 'exempt', vatPercent: 0 },
  }))
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1_000_000_00, label: 'خزينة الصرف الجزئي' })
})

describe('سند صرف جزئي على استحقاق — المتبقي فقط يظهر', () => {
  it('استحقاق 4000 − سلفة 1000 = 3000؛ سند 1000 ⇒ المتبقي 2000؛ سند الباقي 2000 ⇒ مصروفة', () => {
    const id = newEmployee('صرف-جزئي', 400000)
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 100000, treasury: '1101', notes: 'سلفة' } as never)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 100000 }] } as never)
    expect(slip.netMinor).toBe(300000)

    // سند الصرف الأول: 1000 على القسيمة
    S().postVoucher({ kind: 'payment', date: '2026-10-01', treasury: '1101', counterAccountCode: '2104', partyKind: 'employee', partyId: id, amountMinor: 100000, description: 'صرف جزئي', settleSlipIds: [slip.id] } as never)
    const afterFirst = S().payrollSlips.find((r) => r.id === slip.id)!
    expect(afterFirst.status).toBe('accrued')
    expect(slipRemainingMinor(afterFirst)).toBe(200000) // المتبقي 2000 فقط
    expect(ledgerBalance('2104')).toBe(300000 - 100000)
    expect(statementBalance(id)).toBe(200000)

    // سند الصرف الثاني بالمتبقي: 2000 ⇒ القسيمة مصروفة
    S().postVoucher({ kind: 'payment', date: '2026-10-02', treasury: '1101', counterAccountCode: '2104', partyKind: 'employee', partyId: id, amountMinor: 200000, description: 'باقي الراتب', settleSlipIds: [slip.id] } as never)
    const done = S().payrollSlips.find((r) => r.id === slip.id)!
    expect(done.status).toBe('paid')
    expect(slipRemainingMinor(done)).toBe(0)
    expect(ledgerBalance('2104')).toBe(0)
    expect(statementBalance(id)).toBe(0)
  })

  it('الكشف يعرض كل دفعة بمبلغها لا الصافي كاملاً', () => {
    const id = newEmployee('كشف-جزئي', 400000)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] } as never)
    S().postVoucher({ kind: 'payment', date: '2026-10-01', treasury: '1101', counterAccountCode: '2104', partyKind: 'employee', partyId: id, amountMinor: 150000, description: 'جزء', settleSlipIds: [slip.id] } as never)
    const debits = S().getEmployeeStatementRows(id).map((r) => r.debitMinor).filter((d) => d > 0)
    expect(debits).toEqual([150000]) // سطر واحد بالمبلغ المدفوع، لا 4000 كاملة
    expect(statementBalance(id)).toBe(250000)
  })

  it('سند أكبر من المتبقي: يُسدَّد المتبقي وما زاد يبقى مبلغاً عاماً (لا قسيمة مكررة)', () => {
    const id = newEmployee('فائض-سند', 400000)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] } as never)
    S().postVoucher({ kind: 'payment', date: '2026-10-01', treasury: '1101', counterAccountCode: '2104', partyKind: 'employee', partyId: id, amountMinor: 500000, description: 'أكثر', settleSlipIds: [slip.id] } as never)
    expect(S().payrollSlips.find((r) => r.id === slip.id)!.status).toBe('paid')
    // حساب يدوي: استحقاق 4000 (له) − صرف القسيمة 4000 − فائض السند 1000 (عليه) = −1000 عليه
    expect(ledgerBalance('2104')).toBe(400000 - 500000)
    expect(statementBalance(id)).toBe(-100000)
    expect(statementBalance(id)).toBe(ledgerBalance('2104'))
  })
})

describe('صرف القسيمة من المستحقات (payPayrollSlip) جزئياً', () => {
  it('صرف جزئي ثم المتبقي؛ مبلغ أكبر من المتبقي مرفوض؛ القسيمة بها صرف لا تُلغى', () => {
    const id = newEmployee('صرف-مباشر', 300000)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] } as never)
    expect(() => S().payPayrollSlip(slip.id, { treasury: '1101', amountMinor: 400000 })).toThrow()
    S().payPayrollSlip(slip.id, { treasury: '1101', amountMinor: 100000, date: '2026-10-01' })
    expect(slipRemainingMinor(S().payrollSlips.find((r) => r.id === slip.id)!)).toBe(200000)
    expect(() => S().cancelPayrollSlip(slip.id, 'تجربة')).toThrow()
    S().payPayrollSlip(slip.id, { treasury: '1101', date: '2026-10-02' }) // الافتراضي = المتبقي
    expect(S().payrollSlips.find((r) => r.id === slip.id)!.status).toBe('paid')
    expect(ledgerBalance('2104')).toBe(0)
    expect(statementBalance(id)).toBe(0)
  })
})

describe('السلفة الاستقطاعية التلقائية في القسيمة', () => {
  it('الافتراضي = min(المتبقي، نصف الراتب ناقص الخصومات، الصافي قبل السلفة)', () => {
    expect(defaultAdvanceRecovery({ remainingAdvanceMinor: 100000, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0 })).toBe(100000)
    // سلفة كبيرة تُقسَّم: 3000 على راتب 4000 ⇒ الشهر الأول 2000 (نصف الراتب)، والباقي 1000 للشهر التالي
    expect(defaultAdvanceRecovery({ remainingAdvanceMinor: 300000, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0 })).toBe(200000)
    expect(defaultAdvanceRecovery({ remainingAdvanceMinor: 100000, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0 })).toBe(100000)
    // الخصومات تنقص سقف النصف
    expect(defaultAdvanceRecovery({ remainingAdvanceMinor: 300000, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 50000 })).toBe(150000)
    // لا سالب أبداً
    expect(defaultAdvanceRecovery({ remainingAdvanceMinor: 300000, grossMinor: 100000, allowancesMinor: 0, deductionsMinor: 90000 })).toBe(0)
  })

  it('سلفة 3000 على راتب 4000: مسيران يستقطعان 2000 ثم 1000 تلقائياً', () => {
    const id = newEmployee('سلفة-موزعة', 400000)
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 300000, treasury: '1101', notes: 'كبيرة' } as never)
    const first = defaultAdvanceRecovery({ remainingAdvanceMinor: S().getEmployeeAdvanceBalance(id).remainingMinor, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0 })
    S().accruePayrollSlips({ month: '2026-08', date: '2026-08-31', rows: [{ employeeId: id, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: first }] } as never)
    const second = defaultAdvanceRecovery({ remainingAdvanceMinor: S().getEmployeeAdvanceBalance(id).remainingMinor, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0 })
    expect([first, second]).toEqual([200000, 100000])
    S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: second }] } as never)
    expect(S().getEmployeeAdvanceBalance(id).remainingMinor).toBe(0)
    expect(ledgerBalance('1107')).toBe(0)
    expect(statementBalance(id)).toBe(200000 + 300000) // أغسطس 2000 + سبتمبر 3000 مستحقان
  })
})

describe('توزيع السندات والإجماليات', () => {
  it('التوزيع يبدأ بالأقدم ويقف عند المتبقي', () => {
    const slips = [
      { id: 1, status: 'accrued' as const, netMinor: 300000 },
      { id: 2, status: 'accrued' as const, netMinor: 200000, payments: [{ entryId: 9, amountMinor: 50000, date: '2026-10-01', from: 'x' }] },
    ]
    const result = allocateSlipPayments(slips, 400000)
    expect(result.allocations).toEqual([{ slipId: 1, amountMinor: 300000 }, { slipId: 2, amountMinor: 100000 }])
    expect(result.surplusMinor).toBe(0)
  })

  it('إجمالي غير المصروف يحسب المتبقي لا الصافي', () => {
    const totals = slipsTotals([{ id: 1, status: 'accrued', netMinor: 400000, grossMinor: 400000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0, payments: [{ entryId: 1, amountMinor: 150000, date: '2026-10-01', from: 'x' }] } as never])
    expect(totals.unpaid).toBe(250000)
  })
})
