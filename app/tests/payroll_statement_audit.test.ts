/**
 * تدقيق كشف حساب الموظف والرواتب والسلف والخصومات (طلب المالك: التحقق من الحساب الصحيح).
 *
 * كل سيناريو يعيد بناء دورة موظف بالأفعال الحقيقية في المتجر، ثم يتحقق من ثلاثة أشياء:
 *   ① الأرقام المتوقعة يدوياً (الراتب، الصافي، السلف، الخصومات، الاستقطاعات).
 *   ② رصيد كشف الموظف = رصيد 2104 + 2116 + 1107 (المعيار الدفتري).
 *   ③ كل قيد في اليومية متوازن (مدين = دائن).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')

const S = () => useDataStore.getState()
const original = useDataStore.getState()

function ledgerBalance(code: string): number {
  let bal = 0
  for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) bal += l.credit - l.debit
  return bal
}

/** رصيد الكشف بإشارة «له» موجبة: دائن = له، مدين = عليه */
function statementBalance(employeeId: number): number {
  return S().getEmployeeStatementRows(employeeId).reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0)
}

function expectEveryEntryBalanced() {
  for (const e of S().journal) {
    const dr = e.lines.reduce((sum, l) => sum + l.debit, 0)
    const cr = e.lines.reduce((sum, l) => sum + l.credit, 0)
    expect(dr, `قيد ${e.entryNumber} غير متوازن`).toBe(cr)
  }
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
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1_000_000_00, label: 'خزينة التدقيق' })
})

describe('① دورة المستخدم: سلفة مدفوعة ← استحقاق راتب بلا استقطاع ← سداد السلفة نقداً منفصلاً', () => {
  it('الراتب يبقى كما هو، والسلفة تُسدَّد على 1107، والكشف يطابق الدفتر', () => {
    const id = newEmployee('تدقيق-أ', 300000) // راتب 3000.00
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 100000, treasury: '1101', notes: 'سلفة' } as never) // 1000.00 نقداً
    expect(statementBalance(id)).toBe(-100000) // عليه 1000 قبل أي مسير

    // استحقاق بدون استقطاع سلفة (الافتراضي في الواجهة: سلفة = 0)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 }] } as never)
    expect(slip.netMinor).toBe(300000) // الصافي = الراتب كاملاً
    expect(ledgerBalance('2104')).toBe(300000)
    expect(ledgerBalance('1107')).toBe(-100000) // السلفة لا تزال قائمة

    // سداد السلفة نقداً بعد الاستحقاق — لا يمس القسيمة
    S().repayEmployeeAdvance({ employeeId: id, amountMinor: 100000, treasury: '1101' } as never)
    expect(ledgerBalance('1107')).toBe(0)
    expect(S().payrollSlips.find((r) => r.id === slip.id)!.netMinor).toBe(300000)
    expect(ledgerBalance('2104')).toBe(300000)
    expect(S().getEmployeeAdvanceBalance(id).remainingMinor).toBe(0)

    // كشف الحساب: له 3000 (الراتب المستحق) — لا عليه شيء
    expect(statementBalance(id)).toBe(300000)
    expect(statementBalance(id)).toBe(ledgerBalance('2104') + ledgerBalance('2116') + ledgerBalance('1107'))

    // صرف الراتب → الكشف صفر
    S().payPayrollSlip(slip.id, { treasury: '1101', date: '2026-10-01' })
    expect(ledgerBalance('2104')).toBe(0)
    expect(statementBalance(id)).toBe(0)
    expectEveryEntryBalanced()
  })
})

describe('② السلفة تُستقطع من الراتب عند الاستحقاق', () => {
  it('الصافي = الراتب − السلفة، ولا يمكن السداد النقدي بعدها لأن المتبقي صفر', () => {
    const id = newEmployee('تدقيق-ب', 300000)
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 100000, treasury: '1101', notes: 'سلفة' } as never)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 100000 }] } as never)
    expect(slip.netMinor).toBe(200000)
    expect(ledgerBalance('2104')).toBe(200000)
    expect(ledgerBalance('1107')).toBe(0)
    expect(S().getEmployeeAdvanceBalance(id).remainingMinor).toBe(0)
    expect(statementBalance(id)).toBe(200000)
    expect(() => S().repayEmployeeAdvance({ employeeId: id, amountMinor: 100000, treasury: '1101' } as never)).toThrow()
    expectEveryEntryBalanced()
  })
})

describe('③ الخصومات والبدلات والاستقطاعات', () => {
  it('الصافي = أساسي + بدلات − خصومات − سلفة، والمصروف يطابق الصافي + السلفة', () => {
    const id = newEmployee('تدقيق-ج', 300000)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 20000, deductionsMinor: 30000, advanceMinor: 0 }] } as never)
    expect(slip.netMinor).toBe(290000) // 3000 + 200 − 300
    const expense = S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === '5102').reduce((s, l) => s + l.debit - l.credit, 0)
    expect(expense).toBe(290000)
    expect(statementBalance(id)).toBe(290000)
    expectEveryEntryBalanced()
  })

  it('جزاء مسجّل يُسترد من القسيمة ويظهر مستهلكاً، والإلغاء يعيده قائماً', () => {
    const id = newEmployee('تدقيق-د', 300000)
    S().addEmployeeDeduction({ employeeId: id, amountMinor: 20000, reason: 'تأخير', date: '2026-09-10' } as never)
    expect(S().getEmployeeDeductionBalance(id).remainingMinor).toBe(20000)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 20000, advanceMinor: 0 }] } as never)
    expect(S().getEmployeeDeductionBalance(id).remainingMinor).toBe(0)
    S().cancelPayrollSlip(slip.id, 'تجربة')
    expect(S().getEmployeeDeductionBalance(id).remainingMinor).toBe(20000)
    expect(statementBalance(id)).toBe(0)
    expectEveryEntryBalanced()
  })
})

describe('④ الإلغاء يعكس السلفة كاملةً', () => {
  it('قسيمة مستقطعة منها سلفة ثم ملغاة ⇒ السلفة قائمة كما كانت والدفتر صفر', () => {
    const id = newEmployee('تدقيق-هـ', 300000)
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 100000, treasury: '1101', notes: 'سلفة' } as never)
    const [slip] = S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 100000 }] } as never)
    S().cancelPayrollSlip(slip.id, 'خطأ في الإدخال')
    expect(S().getEmployeeAdvanceBalance(id).remainingMinor).toBe(100000)
    expect(ledgerBalance('2104')).toBe(0)
    expect(ledgerBalance('1107')).toBe(-100000)
    expect(statementBalance(id)).toBe(-100000)
    expectEveryEntryBalanced()
  })
})

describe('⑤ توزيع السلفة على أكثر من مسير (الأقدم أولاً)', () => {
  it('سلفتان ومسيران: الاستقطاع الكلي لا يتجاوز الرصيد، والكشف يطابق الدفتر', () => {
    const id = newEmployee('تدقيق-و', 300000)
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 60000, treasury: '1101', notes: 'أ' } as never)
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 50000, treasury: '1101', notes: 'ب' } as never)
    S().accruePayrollSlips({ month: '2026-08', date: '2026-08-31', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 80000 }] } as never)
    expect(S().getEmployeeAdvanceBalance(id).remainingMinor).toBe(30000)
    expect(() => S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 40000 }] } as never)).toThrow()
    S().accruePayrollSlips({ month: '2026-09', date: '2026-09-30', rows: [{ employeeId: id, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 30000 }] } as never)
    expect(S().getEmployeeAdvanceBalance(id).remainingMinor).toBe(0)
    expect(ledgerBalance('1107')).toBe(0)
    expect(statementBalance(id)).toBe(220000 + 270000) // أغسطس 3000−800 + سبتمبر 3000−300
    expect(statementBalance(id)).toBe(ledgerBalance('2104') + ledgerBalance('2116') + ledgerBalance('1107'))
    expectEveryEntryBalanced()
  })
})

describe('⑥ حدود الصافي السالب (فحص سلامة)', () => {
  it('موظف بصافٍ سالب داخل مسير فيه موظف موجب: يجب رفض المسير كله بدل اقتطاع الصافي إلى صفر بصمت', () => {
    const good = newEmployee('تدقيق-ز1', 300000)
    const bad = newEmployee('تدقيق-ز2', 100000)
    S().addEmployeeDeduction({ employeeId: bad, amountMinor: 80000, reason: 'جزاء', date: '2026-09-10' } as never)
    S().grantEmployeeAdvance({ employeeId: bad, amountMinor: 50000, treasury: '1101', notes: 'سلفة' } as never)
    const attempt = () => S().accruePayrollSlips({
      month: '2026-09', date: '2026-09-30', overrideBy: 'مشرف',
      rows: [
        { employeeId: good, grossMinor: 300000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0 },
        { employeeId: bad, grossMinor: 100000, allowancesMinor: 0, deductionsMinor: 80000, advanceMinor: 50000 },
      ],
    } as never)
    expect(attempt).toThrow()
    expect(S().payrollSlips.filter((r) => r.employeeId === bad)).toHaveLength(0)
    expect(S().getEmployeeAdvanceBalance(bad).remainingMinor).toBe(50000)
    expect(S().getEmployeeDeductionBalance(bad).remainingMinor).toBe(80000)
  })
})
