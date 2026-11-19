import { describe, expect, it, afterEach } from 'vitest'
import { summarizeShift, zReportRows, zReportSequence, type Shift, type ShiftDoc } from '../src/core/shifts.ts'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

/**
 * F2 — تقرير Z: مستند إقفال الوردية.
 *
 * العيب قبل الإصلاح: تقرير X جاهز، أما Z (مستند الإقفال الذي يطابقه المحاسب)
 * فلم يكن يخرج مع الإقفال، وكان يخلو من المبيعات والخصم والضريبة والمرتجعات —
 * أي أن الدرج يُقفل بورقة لا تُطابق الدفتر. الاختبار يثبّت: نفس الأرقام من نفس
 * `summarizeShift`، والفرق بقرش، ورقم Z متسلسل، والتسوية ظاهرة برقم قيدها.
 */

const shift: Shift = {
  id: 3, openedAt: '2026-11-17T08:00:00.000Z', openedBy: 'كاشير',
  openingCashMinor: 50_000, closedAt: '2026-11-17T20:00:00.000Z',
  countedCashMinor: 0, status: 'closed',
}

const doc = (patch: Partial<ShiftDoc>): ShiftDoc => ({
  shiftId: 3, payment: 'cash', totalMinor: 0, ...patch,
})

describe('صفوف Z — أرقام من تلخيص واحد', () => {
  const sales: ShiftDoc[] = [
    doc({ totalMinor: 11_500, grossMinor: 12_000, discountMinor: 1_000, taxMinor: 500 }),
    doc({ totalMinor: 5_750, grossMinor: 5_750, discountMinor: 0, taxMinor: 250 }),
    doc({ totalMinor: 3_000, paidMinor: 0, payment: 'credit', grossMinor: 3_000, taxMinor: 0 }),
    doc({ totalMinor: 2_000, grossMinor: 2_000, taxMinor: 0, treasuryKind: 'bank' }),
  ]
  const returns: ShiftDoc[] = [doc({ totalMinor: 1_150, taxMinor: 50 })]

  it('الإجمالي والخصم والضريبة والمرتجعات = مجموع مستندات الوردية', () => {
    const summary = summarizeShift(shift, sales, returns)
    expect(summary.grossSalesMinor).toBe(22_750)
    expect(summary.discountsMinor).toBe(1_000)
    expect(summary.netSalesMinor).toBe(22_250)
    expect(summary.taxMinor).toBe(750 - 50)
    expect(summary.returnsTotalMinor).toBe(1_150)
    // درج: 11,500 + 5,750 + 2,000 (بنك) − 1,150 = لكن البنك لا يدخل الدرج
    expect(summary.bankSalesMinor).toBe(2_000)
    expect(summary.cashSalesMinor).toBe(17_250)
    expect(summary.creditSalesMinor).toBe(3_000)
    expect(summary.expectedCashMinor).toBe(50_000 + 17_250 - 1_150)
  })

  it('صفوف Z تحمل نفس أرقام التلخيص بلا حساب ثانٍ', () => {
    const counted = summarizeShift(shift, sales, returns).expectedCashMinor
    const summary = summarizeShift({ ...shift, countedCashMinor: counted }, sales, returns)
    const rows = zReportRows({ openingCashMinor: shift.openingCashMinor, countedCashMinor: counted }, summary)
    const value = (label: string) => rows.find((r) => r.nameAr.startsWith(label))!.valueMinor
    expect(value('إجمالي المبيعات')).toBe(summary.grossSalesMinor)
    expect(value('الخصومات')).toBe(-summary.discountsMinor!)
    expect(value('صافي المبيعات')).toBe(summary.netSalesMinor)
    expect(value('ض.ق.م')).toBe(summary.taxMinor)
    expect(value('مرتجعات')).toBe(-summary.returnsTotalMinor!)
    expect(value('محصل نقداً')).toBe(summary.cashSalesMinor)
    expect(value('المتوقع')).toBe(summary.expectedCashMinor)
    expect(value('المعدود')).toBe(summary.expectedCashMinor)
    expect(rows.at(-1)!.nameAr).toBe('الفرق (مضبوط)')
  })

  it('الفرق يظهر عجزاً/زيادةً بقرش وبلا تقريب', () => {
    const summary = summarizeShift({ ...shift, countedCashMinor: 66_097 }, sales, returns)
    expect(summary.varianceMinor).toBe(-3)
    const rows = zReportRows({ openingCashMinor: shift.openingCashMinor, countedCashMinor: 66_097 }, summary)
    expect(rows.at(-1)!).toEqual({ nameAr: 'عجز في الدرج', valueMinor: -3 })
  })

  it('رقم Z متسلسل بين الورديات المقفلة فقط', () => {
    const list = [
      { id: 1, status: 'closed' as const },
      { id: 2, status: 'closed' as const },
      { id: 3, status: 'open' as const },
    ]
    expect(zReportSequence(list, 1)).toBe(1)
    expect(zReportSequence(list, 2)).toBe(2)
    expect(zReportSequence(list, 3)).toBe(2)
  })
})

/* ─── التكامل: بيع حقيقي ⇒ إقفال ⇒ Z يطابق الدفتر ─── */
const initial = useRawDataStore.getState()
const app = useAppStore.getState()
const S = () => useDataStore.getState()

afterEach(() => {
  useRawDataStore.setState(initial, true)
  useAppStore.setState(app, true)
})

describe('F2 مع المتجر: Z يُقرأ من الفواتير الحقيقية', () => {
  it('فاتورة بخصم وضريبة: Z يطابق إجمالي الفاتورة والدرج', () => {
    useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', taxInclusive: false, allowNegativeTreasury: true } })
    useRawDataStore.setState({
      ...initial, branches: [], activeBranchId: null, currentUserId: null, appUsers: [],
      items: [], journal: [], shifts: [], sales: [], saleReturns: [], batches: [], employees: [],
      warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }],
    } as never)
    S().addItem({
      nameAr: 'شاي', sku: '', barcodes: [], categoryId: 1, baseUnit: 'علبة', extraUnits: [],
      costMinor: 4_000, stockQty: 10, priceMinor: 10_000, minQty: 0, trackExpiry: false,
      trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
    } as never)
    const item = S().items[0]
    S().openShift('كاشير', 100_000)
    const sale = S().postSale({
      lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 10_000, unitCostMinor: 4_000, discountPercent: 10, soldByWeight: false }],
      customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 5, taxInclusive: false,
      treasury: '1101',
    } as never)
    const shiftId = S().shifts[0].id
    const summary = S().getShiftSummary(shiftId)
    expect(summary.invoiceCount).toBe(1)
    expect(summary.grossSalesMinor).toBe(20_000)
    expect(summary.discountsMinor).toBe(2_000)
    expect(summary.taxMinor).toBe(sale.totals.taxMinor)
    expect(summary.netSalesMinor).toBe(sale.totals.totalMinor)
    expect(summary.cashSalesMinor).toBe(sale.totals.totalMinor)

    const closed = S().closeShift(summary.expectedCashMinor, null, null)
    const after = S().getShiftSummary(closed.id)
    const rows = zReportRows(closed, after)
    expect(rows.find((r) => r.nameAr.startsWith('صافي المبيعات'))!.valueMinor).toBe(sale.totals.totalMinor)
    expect(rows.find((r) => r.nameAr.startsWith('المعدود'))!.valueMinor).toBe(sale.totals.totalMinor + 100_000)
    /* الدرج مضبوط بالقرش: Z لا يخفي قرشاً ولا يضيفه */
    expect(after.varianceMinor).toBe(0)
    expect(zReportSequence(S().shifts, closed.id)).toBe(1)
  })
})
