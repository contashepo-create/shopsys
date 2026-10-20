/**
 * الفجوة ج (بلاغ المالك): لمّا جزء من سلفة/خصم يتبقى ويُستكمل استقطاعه في مسير
 * شهر لاحق، يجب أن يظهر مستند المسير نفسه توضيحاً تلقائياً «مُرحَّل من شهر كذا
 * وسببه كذا» — لا تتبّع صامت للرصيد فقط.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')

const S = () => useDataStore.getState()
const original = useDataStore.getState()

function newEmployee(name: string, salaryMinor: number): number {
  S().addEmployee({ nameAr: name, phone: '', roleId: 'cashier', salaryMinor, active: true } as never)
  return S().employees.find((e) => e.nameAr === name)!.id
}

beforeEach(() => {
  useDataStore.setState(original)
  useAppStore.setState((s) => ({
    setup: { ...s.setup, completed: true, activityId: 'supermarket', countryCode: 'EG', taxRegistrationStatus: 'exempt', vatPercent: 0 },
  }))
  S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1_000_000_00, label: 'خزينة المسير' })
})

describe('مستند المسير يوثّق تلقائياً البنود المُرحَّلة من أشهر سابقة', () => {
  it('سلفة نشأت في شهر سابق ولم تُسدَّد بالكامل: تظهر ملاحظة ترحيل عليها في مسير الشهر التالي', () => {
    const id = newEmployee('مرحّل-سلفة', 500000)
    // سلفة بتاريخ أغسطس 2026 بقيمة 2000، لم يُسترد منها شيء بعد
    useDataStore.setState((s) => ({
      employeeAdvances: [...s.employeeAdvances, {
        id: 1, advanceNumber: 'ADV-0001', employeeId: id, date: '2026-08-15',
        amountMinor: 200000, recoveredMinor: 0, source: 'cash' as const,
        custodyFileId: null, treasury: '1101' as const, notes: 'سلفة شخصية لظرف طارئ', journalEntryId: 0,
      }],
    }))
    // مسير سبتمبر: استقطاع 800 فقط من السلفة (جزئي)
    const run = S().postPayroll({
      month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '',
      lines: [{ employeeId: id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 80000 }],
    })
    const line = run.lines.find((l) => l.employeeId === id)!
    expect(line.carryItems).toBeDefined()
    expect(line.carryItems).toHaveLength(1)
    const item = line.carryItems![0]
    expect(item.kind).toBe('advance')
    expect(item.number).toBe('ADV-0001')
    expect(item.reason).toBe('سلفة شخصية لظرف طارئ')
    expect(item.originMonth).toBe('2026-08')
    expect(item.carriedOverMinor).toBe(200000) // المتبقي قبل هذا المسير
    expect(item.takenMinor).toBe(80000) // المستقطع فعلياً هذا الشهر

    // مسير أكتوبر: استقطاع الـ1200 المتبقية — يظل مُرحَّلاً من أغسطس أيضاً
    const run2 = S().postPayroll({
      month: '2026-10', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '',
      lines: [{ employeeId: id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 120000 }],
    })
    const line2 = run2.lines.find((l) => l.employeeId === id)!
    const item2 = line2.carryItems![0]
    expect(item2.originMonth).toBe('2026-08')
    expect(item2.carriedOverMinor).toBe(120000) // المتبقي وقتها (بعد أخذ 800 في سبتمبر)
    expect(item2.takenMinor).toBe(120000)
  })

  it('خصم/جزاء نشأ في شهر سابق: يظهر برقمه وسببه الأصلي عند استقطاعه لاحقاً', () => {
    const id = newEmployee('مرحّل-خصم', 500000)
    useDataStore.setState((s) => ({
      employeeDeductions: [...s.employeeDeductions, {
        id: 1, dedNumber: 'DED-0001', employeeId: id, date: '2026-07-10',
        amountMinor: 50000, recoveredMinor: 0, reason: 'جزاء تأخير متكرر', notes: '',
      }],
    }))
    const run = S().postPayroll({
      month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '',
      lines: [{ employeeId: id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 50000, advancesMinor: 0 }],
    })
    const line = run.lines.find((l) => l.employeeId === id)!
    expect(line.carryItems).toHaveLength(1)
    const item = line.carryItems![0]
    expect(item.kind).toBe('deduction')
    expect(item.number).toBe('DED-0001')
    expect(item.reason).toBe('جزاء تأخير متكرر')
    expect(item.originMonth).toBe('2026-07')
    expect(item.takenMinor).toBe(50000)
  })

  it('سلفة/خصم نشأ في نفس شهر المسير: لا يُعتبر «مُرحَّلاً» ولا تُضاف ملاحظة', () => {
    const id = newEmployee('بلا-ترحيل', 500000)
    S().grantEmployeeAdvance({ employeeId: id, amountMinor: 100000, treasury: '1101', notes: 'سلفة هذا الشهر' })
    const run = S().postPayroll({
      month: new Date().toISOString().slice(0, 7), payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '',
      lines: [{ employeeId: id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 100000 }],
    })
    const line = run.lines.find((l) => l.employeeId === id)!
    expect(line.carryItems ?? []).toHaveLength(0)
  })

  it('لا سلف ولا خصومات مُرحَّلة: carryItems غير معرَّف على السطر', () => {
    const id = newEmployee('عادي', 500000)
    const run = S().postPayroll({
      month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '',
      lines: [{ employeeId: id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }],
    })
    const line = run.lines.find((l) => l.employeeId === id)!
    expect(line.carryItems).toBeUndefined()
  })
})
