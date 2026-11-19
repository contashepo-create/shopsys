import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ShiftsPage } from '../src/ui/pages/ShiftsPage.tsx'

/**
 * F5 — إقفال الوردية يولّد قيد الفرق تلقائياً (اختيارياً) في نفس اللحظة.
 * F2 — تقرير Z للمالك من الوردية المقفلة (مستند إقفال، لا معاينة).
 *
 * كان الإقفال يترك الفرق معلّقاً ويحتاج إجراءً ثانياً يدوياً؛ وكان لا يوجد مستند
 * Z مطبوع للوردية المقفلة. الاختبار يثبّت: قيد واحد ذريّ، ومتوازن، ومرتبط بالوردية،
 * وأن الإقفال بلا فرق لا يولّد قيداً، وأن الزيادة لا تُحمَّل سلفةً.
 */

const initial = useRawDataStore.getState()
const app = useAppStore.getState()
const S = () => useDataStore.getState()

afterEach(() => {
  cleanup()
  useRawDataStore.setState(initial, true)
  useAppStore.setState(app, true)
})

function freshShift(openingMinor = 100000) {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({
    ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null,
    items: [], insuranceProviders: [], insuranceClaims: [], journal: [], shifts: [],
    employees: [], employeeAdvances: [], batches: [],
    warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }],
  } as never)
  S().addItem({
    nameAr: 'صنف', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: 100, stockQty: 10, priceMinor: 1000, minQty: 0, trackExpiry: false,
    trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  } as never)
  /* لا فواتير: المتوقع في الدرج = الافتتاحي وحده، فأي فرق مقصود يكون مضبوطاً بالقرش */
  S().openShift('كاشير', openingMinor)
  return S().getShiftSummary(S().shifts[0].id)
}

describe('F5 — تسوية فرق الوردية في نفس الإقفال', () => {
  it('إقفال بعجز مع خيار التسوية يُنشئ قيداً متوازناً ويربطه بالوردية في خطوة واحدة', () => {
    const summary = freshShift()
    const before = S().journal.length
    // معدود أقل من المتوقع بـ 5.00
    const shift = S().closeShift(summary.expectedCashMinor - 500, 'المالك', 'اعتماد عجز', { mode: 'expense' })
    expect(S().journal.length).toBe(before + 1)
    const entry = S().journal.at(-1)!
    expect(entry.sourceType).toBe('adjustment')
    expect(entry.sourceId).toBe(shift.id)
    const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0)
    const credit = entry.lines.reduce((sum, line) => sum + line.credit, 0)
    expect(debit).toBe(credit)
    expect(shift.varianceSettledMode).toBe('expense')
    expect(shift.varianceEntryId).toBe(entry.id)
    expect(S().getShiftSummary(shift.id).varianceMinor).toBe(-500)
    // لا يبقى الفرق معلّقاً: التسوية المستقلة ترفض التكرار
    expect(() => S().settleShiftVariance({ shiftId: shift.id, mode: 'expense' })).toThrow(/بالفعل/)
  })

  it('إقفال بلا خيار التسوية يترك الفرق معلّقاً بلا قيد (السلوك القديم محفوظ)', () => {
    const summary = freshShift()
    const before = S().journal.length
    const shift = S().closeShift(summary.expectedCashMinor - 500, 'المالك', 'اعتماد عجز')
    expect(S().journal.length).toBe(before)
    expect(shift.varianceSettledMode).toBeUndefined()
    const settled = S().settleShiftVariance({ shiftId: shift.id, mode: 'expense' })
    expect(settled.varianceSettledMode).toBe('expense')
    expect(S().journal.length).toBe(before + 1)
  })

  it('درج مضبوط: لا قيد ولا تسوية حتى لو طُلب الخيار', () => {
    const summary = freshShift()
    const before = S().journal.length
    const shift = S().closeShift(summary.expectedCashMinor, null, null, { mode: 'expense' })
    expect(S().journal.length).toBe(before)
    expect(shift.varianceSettledMode).toBeUndefined()
  })

  it('تسوية الفرق في الإقفال بلا اعتماد مشرف تُرفض — الاعتماد شرط لا خيار', () => {
    const summary = freshShift()
    expect(() => S().closeShift(summary.expectedCashMinor - 500, null, null, { mode: 'expense' })).toThrow(/اعتماد/)
    expect(S().shifts[0].status).toBe('open')
  })

  it('الزيادة لا تُحمَّل سلفة على موظف — تُسوّى إيراداً', () => {
    const summary = freshShift()
    S().employees.push({ id: 7, nameAr: 'موظف', jobTitle: '', phone: '', active: true } as never)
    expect(() => S().closeShift(summary.expectedCashMinor + 700, 'المالك', 'اعتماد زيادة', { mode: 'advance', employeeId: 7 })).toThrow(/السلفة/)
  })
})

describe('F2 — تقرير Z للوردية المقفلة', () => {
  it('سجل الورديات المقفلة يعرض زر تقرير Z لكل وردية', () => {
    const summary = freshShift()
    const shift = S().closeShift(summary.expectedCashMinor - 500, 'المالك', 'اعتماد عجز', { mode: 'expense' })
    render(<ShiftsPage />)
    const button = screen.getByTitle(/تقرير Z/)
    expect(button).toBeTruthy()
    expect(button.getAttribute('data-z-report')).toBe(String(shift.id))
  })
})

describe('F6 — ربط الوردية بهوية مسجَّلة لا بنص حر', () => {
  it('مستخدم الجلسة يُربط تلقائياً، والموظف يُربط فقط بتطابق اسم وحيد', () => {
    useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
    useRawDataStore.setState({
      ...initial, branches: [], activeBranchId: null, shifts: [], journal: [], currentUserId: 5,
      appUsers: [{ id: 5, nameAr: 'سالم', active: true }],
      employees: [{ id: 11, nameAr: 'سالم', active: true }, { id: 12, nameAr: 'سالم', active: true }],
    } as never)
    const shift = S().openShift('سالم', 0)
    expect(shift.openedByUserId).toBe(5)
    /* اسم مكرر بين موظفين ⇒ لا ربط تخميناً */
    expect(shift.openedByEmployeeId ?? null).toBeNull()
  })

  it('موظف صريح يُربط، والموظف الموقوف يُرفض، والموظف الوحيد يُستنتج', () => {
    useRawDataStore.setState({
      ...initial, branches: [], activeBranchId: null, shifts: [], journal: [], currentUserId: null,
      appUsers: [], employees: [{ id: 21, nameAr: 'هند', active: true }, { id: 22, nameAr: 'سامي', active: false }],
    } as never)
    const shift = S().openShift('هند', 0)
    expect(shift.openedByEmployeeId).toBe(21)
    S().closeShift(0, null, null)
    const second = S().openShift('موظف يدوي', 0, { employeeId: 21 })
    expect(second.openedByEmployeeId).toBe(21)
    expect(() => S().closeShift(0, null, null)).not.toThrow()
    expect(() => S().openShift('آخر', 0, { employeeId: 22 })).toThrow(/موقوف/)
    expect(() => S().openShift('آخر', 0, { employeeId: 999 })).toThrow(/غير موجود/)
  })

  it('مستخدم غير موجود في الفرع يُرفض بدل حفظ هوية وهمية', () => {
    useRawDataStore.setState({
      ...initial, branches: [], activeBranchId: null, shifts: [], journal: [], currentUserId: null, appUsers: [], employees: [],
    } as never)
    expect(() => S().openShift('مجهول', 0, { userId: 404 })).toThrow(/غير موجود/)
  })
})
