/**
 * بلاغ المالك v1.0.4: «كشف حساب موظف يحسب بشكل خاطئ» — هذا الاختبار يعيد بناء
 * دورة موظف كاملة بالأفعال الحقيقية ويحكم على رصيد الكشف بمعيار الدفاتر:
 *
 *   رصيد كشف الموظف (له − عليه) = رصيد 2104 (رواتب مستحقة — دائن)
 *                                 − رصيد 1107 (سلف الموظفين — مدين)
 *
 * أي انحراف بين الكشف والدفترين = حساب خاطئ بمعيار محاسبي لا بمعيار عرض.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')

const S = () => useDataStore.getState()
const original = useDataStore.getState()

/** رصيد حساب من الدفتر (بالإشارة الطبيعية: دائن موجب لحقوق الملكية/الالتزامات) */
function ledgerBalance(code: string): number {
  let bal = 0
  for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) bal += l.credit - l.debit
  return bal
}

beforeAll(() => {
  useDataStore.setState(original)
  useAppStore.setState((s) => ({
    setup: { ...s.setup, completed: true, activityId: 'supermarket', countryCode: 'EG', taxRegistrationStatus: 'exempt', vatPercent: 0 },
  }))
  // خزينة برصيد يكفي الصرف
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1_000_000_00, label: 'خزينة الاختبار' })
})

describe('كشف حساب الموظف — المعيار الدفتري (بلاغ v1.0.4)', () => {
  it('دورة كاملة: سلفة + مسير باستقطاع + صرف + سداد نقدي + عمولة = الرصيد يطابق 2104 و1107', () => {
    S().addEmployee({ nameAr: 'موظف الكشف', phone: '', roleId: 'cashier', salaryMinor: 500000, active: true } as never)
    const emp = S().employees.find((e) => e.nameAr === 'موظف الكشف')!

    // ① سلفة نقدية 1000.00
    S().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 100000, treasury: '1101', notes: 'سلفة اختبار' } as never)
    // ② سداد نقدي خارج المسير 200.00
    S().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 20000, treasury: '1101' } as never)

    // ③ مسير رواتب: أساسي 5000 · خصومات 200 · سلف مستقطعة 300 ⇒ صافي 4500
    S().accruePayrollSlips({
      month: '2026-09', date: '2026-09-30',
      rows: [{ employeeId: emp.id, grossMinor: 500000, allowancesMinor: 0, deductionsMinor: 20000, advanceMinor: 30000 }],
    } as never)
    const slip = S().payrollSlips.find((row) => row.employeeId === emp.id && row.month === '2026-09')!
    expect(slip).toBeTruthy()
    expect(slip.netMinor).toBe(450000) // 5000 − 200 خصم − 300 سلفة
    // ④ صرف القسيمة نقداً
    S().payPayrollSlip(slip.id, { treasury: '1101', date: '2026-10-05' })

    // ⑤ عمولة مستحقة 300.00
    S().addStaffCommission({ employeeId: emp.id, source: 'manual' as never, sourceId: null, description: 'عمولة اختبار', amountMinor: 30000 })

    /* الحساب اليدوي المتوقع:
       سلفة نقدية: عليه 1000 (مدين) · سداد نقدي: له 200 (دائن)
       استحقاق راتب: له 4500 · سلفة استُردت من المسير: له 300 (سداد دين السلفة)
       صرف الراتب: عليه 4500 · عمولة مستحقة: له 300
       الرصيد = (200 + 4500 + 300 + 300) − (1000 + 4500) = +800 له (دائن)
       تحقق دفتري: 2104 = عمولة مستحقة 300 (الصافي سُدد) · 1107 = 1000 − 300 − 200 = 500 مدين
       المعادلة: 300 − 500 = −800؟ لا: رصيد الكشف له موجب 800، ومعادلة الدفتر:
       له = bal(2104 دائن) − bal(1107 مدين) = 300 − 500 = −200 !! */

    for (const e of S().journal) for (const l of e.lines) {
    }
    const rows = S().getEmployeeStatementRows(emp.id)
    const statementBalance = rows.reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0)
    const bal2116 = ledgerBalance('2116') // عمولات موظفين مستحقة — هي صاحبة سطر العمولة، لا 2104
    const bal2104 = ledgerBalance('2104')
    const bal1107 = ledgerBalance('1107')
    // eslint-disable-next-line no-console
    // الحكم: رصيد الكشف يجب أن يطابق المعادلة الدفترية بالضبط
    /* المعادلة الدفترية الكاملة لرصيد كشف الموظف (له موجب) — وledgerBalance
       يعيد credit−debit، فحساب السلف «المدين» يأتي سالباً ويكفي جمع الحدود:
       رصيد الكشف = bal(2104: رواتب مستحقة غير مصروفة)
                  + bal(2116: عمولات موظفين مستحقة)
                  + bal(1107: سلف قائمة — مدين فيأتي بالسالب)
       هذا عقدُ الكشف نفسه (getEmployeeStatementRows): كل دائن «له» وكل مدين «عليه».
       الرقم هنا: 0 + 300 − 500 = −200 أي «عليه 200» (سلفة قائمة 500 − عمولة 300). */
    expect(statementBalance).toBe(bal2104 + bal2116 + bal1107)
    expect(statementBalance).toBe(-20000) // قيمة السيناريو بذاتها — بوابة ثابتة لا تنزلق
  })
})
