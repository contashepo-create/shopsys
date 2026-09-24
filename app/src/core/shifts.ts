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
  /** اسم المشرف/المالك الذي اعتمد إقفال وردية بها فرق نقدي — null/undefined = فرق صفر أو سجل قديم */
  closeApprovedBy?: string | null
  /** سبب الاعتماد عند وجود عجز/زيادة وقت الإقفال */
  closeApprovalNote?: string | null
  /** تسوية العجز/الزيادة (طلب المالك): مصروف، أو سلفة على الموظف تُخصم من رواتبه */
  varianceSettledMode?: 'expense' | 'advance' | null
  varianceEntryId?: number | null // قيد التسوية
  varianceAdvanceId?: number | null // السلفة المنشأة (لو عجز على الموظف)
}

/** مستند يُحتسب داخل الوردية (فاتورة أو مرتجع) */
export interface ShiftDoc {
  shiftId: number | null
  payment: 'cash' | 'credit'
  totalMinor: Minor
  /** المحصل فعلاً وقت البيع (الدفع المجزأ) — undefined = حسب payment */
  paidMinor?: Minor
  /** وجهة التحصيل: درج نقدي أم بنك؟ (التحصيل البنكي لا يدخل عدّ الدرج) */
  treasuryKind?: 'cash' | 'bank'
}

export interface ShiftSummary {
  invoiceCount: number
  returnCount: number
  cashSalesMinor: Minor // المحصل نقداً في الدرج
  bankSalesMinor: Minor // المحصل على بنوك/محافظ (لا يدخل عدّ الدرج)
  creditSalesMinor: Minor // الجزء الآجل فقط (الدفع المجزأ يقسم الفاتورة)
  cashRefundsMinor: Minor
  /** المتوقع في الدرج = الافتتاحي + محصل نقدي − مرتجعات نقدية */
  expectedCashMinor: Minor
  /** المعدود − المتوقع (null قبل العد): سالب = عجز، موجب = زيادة */
  varianceMinor: Minor | null
}

/** المحصل فعلاً من مستند (الدفع المجزأ) — التوافق الخلفي: cash=كامل، credit=صفر */
function paidOf(d: ShiftDoc): Minor {
  return d.paidMinor ?? (d.payment === 'cash' ? d.totalMinor : 0)
}

/** تلخيص وردية من مستنداتها — منطق خالص قابل للفحص */
export function summarizeShift(shift: Shift, sales: ShiftDoc[], returns: ShiftDoc[]): ShiftSummary {
  const mySales = sales.filter((s) => s.shiftId === shift.id)
  const myReturns = returns.filter((r) => r.shiftId === shift.id)
  let cashSales = 0, bankSales = 0, creditSales = 0
  for (const s of mySales) {
    const paid = paidOf(s)
    // المحصل يذهب للدرج أو للبنك حسب الخزينة المختارة وقت البيع
    if (s.treasuryKind === 'bank') bankSales += paid
    else cashSales += paid
    creditSales += s.totalMinor - paid // الجزء الآجل فقط — لا الفاتورة كلها
  }
  const cashRefunds = myReturns.filter((r) => r.payment === 'cash' && r.treasuryKind !== 'bank').reduce((a, r) => a + r.totalMinor, 0)
  const expected = shift.openingCashMinor + cashSales - cashRefunds
  return {
    invoiceCount: mySales.length,
    returnCount: myReturns.length,
    cashSalesMinor: cashSales,
    bankSalesMinor: bankSales,
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

/**
 * سياسة الوردية في سياق البيع/الدفع.
 *
 * الإعداد العام يظل سياسة الكاشير: المالك الرئيسي يرى تلميحاً فقط،
 * والكاشير يُمنع أو يُسمح له بحسب الإعداد. أما أي دور موظف آخر ينفذ
 * نشاطاً يحتاج وردية فيُطلب منه فتحها حتى لو عطّل المالك مفتاح الكاشير.
 * أنشطة «الفاتورة أولاً» خارج هذا السياق ولا تحتاج وردية.
 */
export interface SalesShiftPolicyInput {
  roleId: string | null | undefined
  isOwner: boolean
  requireOpenShiftForSales: boolean
  invoiceFirst: boolean
}

export interface SalesShiftPolicy {
  required: boolean
  hintOnly: boolean
  messageAr: string
}

export function salesShiftPolicy(input: SalesShiftPolicyInput): SalesShiftPolicy {
  if (input.invoiceFirst) {
    return { required: false, hintOnly: false, messageAr: '' }
  }
  if (input.isOwner) {
    return {
      required: false,
      hintOnly: true,
      messageAr: 'الوردية اختيارية للمالك الرئيسي — افتحها إن أردت ربط النقدية بعهدة وردية',
    }
  }
  if (input.roleId === 'cashier') {
    const required = input.requireOpenShiftForSales
    return {
      required,
      hintOnly: !required,
      messageAr: required
        ? 'لا يمكن للكاشير إتمام البيع أو الدفع قبل فتح وردية مفتوحة'
        : 'سياسة الكاشير تسمح بالبيع والدفع بلا وردية مفتوحة',
    }
  }
  return {
    required: true,
    hintOnly: false,
    messageAr: 'لا يمكن لهذا المستخدم إتمام العملية قبل فتح وردية مرتبطة بدوره وسياق عمله',
  }
}

/* ─── تسوية عجز/زيادة الوردية (طلب المالك) ─── */

export interface VarianceEntryLine {
  accountCode: string
  debit: Minor
  credit: Minor
  note: string
}

/**
 * قيد تسوية فرق الوردية «كمصروف/إيراد» — دالة خالصة:
 * عجز (variance سالب): مدين 5108 مصروفات عمومية / دائن الخزينة (النقص خرج من الدرج فعلاً)
 * زيادة (variance موجب): مدين الخزينة / دائن 4110 إيرادات أخرى (فائض عدّ)
 */
export function buildVarianceExpenseEntry(varianceMinor: Minor, treasury: string, label: string): VarianceEntryLine[] {
  if (!Number.isInteger(varianceMinor) || varianceMinor === 0) throw new RangeError('لا فرق للتسوية')
  const amount = Math.abs(varianceMinor)
  const lines: VarianceEntryLine[] =
    varianceMinor < 0
      ? [
          { accountCode: '5108', debit: amount, credit: 0, note: `عجز وردية ${label}` },
          { accountCode: treasury, debit: 0, credit: amount, note: 'تسوية درج الوردية' },
        ]
      : [
          { accountCode: treasury, debit: amount, credit: 0, note: 'فائض عدّ الوردية' },
          { accountCode: '4110', debit: 0, credit: amount, note: `زيادة وردية ${label}` },
        ]
  const dr = lines.reduce((a, l) => a + l.debit, 0)
  const cr = lines.reduce((a, l) => a + l.credit, 0)
  if (dr !== cr) throw new RangeError('قيد التسوية غير متوازن')
  return lines
}

/**
 * قيد تحميل العجز «سلفة على الموظف» (تُخصم من رواتبه لاحقاً):
 * مدين 1107 سلف موظفين / دائن الخزينة — العجز خرج من الدرج ويتحمله الموظف
 */
export function buildVarianceAdvanceEntry(varianceMinor: Minor, treasury: string, employeeName: string): VarianceEntryLine[] {
  if (!Number.isInteger(varianceMinor) || varianceMinor >= 0) throw new RangeError('السلفة تكون عن عجز فقط (فرق سالب)')
  const amount = Math.abs(varianceMinor)
  return [
    { accountCode: '1107', debit: amount, credit: 0, note: `عجز وردية على ${employeeName}` },
    { accountCode: treasury, debit: 0, credit: amount, note: 'تسوية درج الوردية' },
  ]
}
