/**
 * ورديات الكاشير — ShopSys (استكمال المرحلة 2)
 * ─────────────────────────────────────────────
 * الوردية تفتح برصيد درج افتتاحي، وتُحصي مبيعات الكاش والآجل
 * والمرتجعات النقدية أثناءها، وعند الإقفال يُدخل الكاشير النقدية
 * المعدودة فعلياً فيظهر العجز/الزيادة فوراً (تسوية الدرج).
 */
import type { Minor } from './money.ts'

export interface Shift {
  id: number
  openedAt: string // ISO datetime
  openedBy: string
  openingCashMinor: Minor // رصيد الدرج الافتتاحي
  closedAt: string | null
  countedCashMinor: Minor | null // النقدية المعدودة عند الإقفال
  status: 'open' | 'closed'
}

/** مستند يُحتسب داخل الوردية (فاتورة أو مرتجع) */
export interface ShiftDoc {
  shiftId: number | null
  payment: 'cash' | 'credit'
  totalMinor: Minor
}

export interface ShiftSummary {
  invoiceCount: number
  returnCount: number
  cashSalesMinor: Minor
  creditSalesMinor: Minor
  cashRefundsMinor: Minor
  /** المتوقع في الدرج = الافتتاحي + مبيعات كاش − مرتجعات كاش */
  expectedCashMinor: Minor
  /** المعدود − المتوقع (null قبل العد): سالب = عجز، موجب = زيادة */
  varianceMinor: Minor | null
}

/** تلخيص وردية من مستنداتها — منطق خالص قابل للفحص */
export function summarizeShift(shift: Shift, sales: ShiftDoc[], returns: ShiftDoc[]): ShiftSummary {
  const mySales = sales.filter((s) => s.shiftId === shift.id)
  const myReturns = returns.filter((r) => r.shiftId === shift.id)
  const cashSales = mySales.filter((s) => s.payment === 'cash').reduce((a, s) => a + s.totalMinor, 0)
  const creditSales = mySales.filter((s) => s.payment === 'credit').reduce((a, s) => a + s.totalMinor, 0)
  const cashRefunds = myReturns.filter((r) => r.payment === 'cash').reduce((a, r) => a + r.totalMinor, 0)
  const expected = shift.openingCashMinor + cashSales - cashRefunds
  return {
    invoiceCount: mySales.length,
    returnCount: myReturns.length,
    cashSalesMinor: cashSales,
    creditSalesMinor: creditSales,
    cashRefundsMinor: cashRefunds,
    expectedCashMinor: expected,
    varianceMinor: shift.countedCashMinor === null ? null : shift.countedCashMinor - expected,
  }
}

/** التحقق قبل فتح وردية: لا ورديتين مفتوحتين معاً، ولا رصيد سالب */
export function validateOpenShift(openingCashMinor: Minor, shifts: Shift[]): string[] {
  const errors: string[] = []
  if (openingCashMinor < 0) errors.push('رصيد الدرج الافتتاحي لا يكون سالباً')
  if (shifts.some((s) => s.status === 'open')) errors.push('توجد وردية مفتوحة بالفعل — أقفلها أولاً')
  return errors
}

export function currentOpenShift(shifts: Shift[]): Shift | null {
  return shifts.find((s) => s.status === 'open') ?? null
}
