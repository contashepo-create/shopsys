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
  /** F6: هوية فاتح الوردية — مستخدم نظام و/أو موظف مسجَّل. الاسم أعلاه للعرض فقط. */
  openedByUserId?: number | null
  openedByEmployeeId?: number | null
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
  /** فاتورة توثيق مستخلصات (النموذج أ): ليست بيع وردية — تُستثنى من التلخيص */
  projectBilling?: 'documentation' | 'extra'
  /* ─── F2: حقول تقرير Z (اختيارية: سجلات قديمة قد لا تحملها) ─── */
  /** إجمالي المستند قبل الخصم */
  grossMinor?: Minor
  /** الخصومات (سطور + فاتورة) */
  discountMinor?: Minor
  /** الضريبة المحصلة على المستند */
  taxMinor?: Minor
}

export interface ShiftSummary {
  invoiceCount: number
  returnCount: number
  cashSalesMinor: Minor // المحصل نقداً في الدرج
  bankSalesMinor: Minor // المحصل على بنوك/محافظ (لا يدخل عدّ الدرج)
  creditSalesMinor: Minor // الجزء الآجل فقط (الدفع المجزأ يقسم الفاتورة)
  cashRefundsMinor: Minor
  cashInsuranceReceiptsMinor: Minor
  bankInsuranceReceiptsMinor: Minor
  cashInsurancePaymentsMinor: Minor
  bankInsurancePaymentsMinor: Minor
  /** المتوقع في الدرج = الافتتاحي + محصل نقدي − مرتجعات نقدية */
  expectedCashMinor: Minor
  /** المعدود − المتوقع (null قبل العد): سالب = عجز، موجب = زيادة */
  varianceMinor: Minor | null
  /* ─── F2: أرقام تقرير Z — تُحسب من نفس المستندات فلا تختلف عن الشاشة ─── */
  /** إجمالي المبيعات قبل الخصم */
  grossSalesMinor?: Minor
  /** إجمالي الخصومات */
  discountsMinor?: Minor
  /** الضريبة المحصلة (ض.ق.م) داخل الوردية */
  taxMinor?: Minor
  /** صافي المبيعات بعد الخصم (يشمل الضريبة كما في الفاتورة) */
  netSalesMinor?: Minor
  /** إجمالي المرتجعات (نقدية + على البنك) */
  returnsTotalMinor?: Minor
  /** المرتجعات على البنك/المحافظ — لا تُخصم من الدرج */
  bankRefundsMinor?: Minor
}

/** المحصل فعلاً من مستند (الدفع المجزأ) — التوافق الخلفي: cash=كامل، credit=صفر */
function paidOf(d: ShiftDoc): Minor {
  return d.paidMinor ?? (d.payment === 'cash' ? d.totalMinor : 0)
}

/** تلخيص وردية من مستنداتها — منطق خالص قابل للفحص */
export function summarizeShift(shift: Shift, sales: ShiftDoc[], returns: ShiftDoc[], insuranceReceipts: ShiftDoc[] = [], insurancePayments: ShiftDoc[] = []): ShiftSummary {
  /* مستندات التوثيق الضريبية لا مبيعات وردية ولا تحصيل بها — خارج التلخيص */
  const mySales = sales.filter((s) => s.shiftId === shift.id && s.projectBilling !== 'documentation')
  const myReturns = returns.filter((r) => r.shiftId === shift.id && r.projectBilling !== 'documentation')
  let cashSales = 0, bankSales = 0, creditSales = 0
  for (const s of mySales) {
    const paid = paidOf(s)
    // المحصل يذهب للدرج أو للبنك حسب الخزينة المختارة وقت البيع
    if (s.treasuryKind === 'bank') bankSales += paid
    else cashSales += paid
    creditSales += s.totalMinor - paid // الجزء الآجل فقط — لا الفاتورة كلها
  }
  const cashRefunds = myReturns.filter((r) => r.payment === 'cash' && r.treasuryKind !== 'bank').reduce((a, r) => a + r.totalMinor, 0)
  const bankRefunds = myReturns.filter((r) => r.treasuryKind === 'bank').reduce((a, r) => a + r.totalMinor, 0)
  /* F2: أرقام تقرير Z من نفس المستندات — بلا استعلام ثانٍ يختلف عنه */
  const grossSales = mySales.reduce((a, s) => a + (s.grossMinor ?? s.totalMinor), 0)
  const discounts = mySales.reduce((a, s) => a + (s.discountMinor ?? 0), 0)
  const tax = mySales.reduce((a, s) => a + (s.taxMinor ?? 0), 0) - myReturns.reduce((a, r) => a + (r.taxMinor ?? 0), 0)
  const netSales = mySales.reduce((a, s) => a + s.totalMinor, 0)
  const returnsTotal = myReturns.reduce((a, r) => a + r.totalMinor, 0)
  const movementTotal = (docs: ShiftDoc[], kind: 'cash' | 'bank') => docs.filter(d => d.shiftId === shift.id && (d.treasuryKind ?? 'cash') === kind).reduce((sum, d) => sum + d.totalMinor, 0)
  const cashInsuranceReceiptsMinor = movementTotal(insuranceReceipts, 'cash'), bankInsuranceReceiptsMinor = movementTotal(insuranceReceipts, 'bank')
  const cashInsurancePaymentsMinor = movementTotal(insurancePayments, 'cash'), bankInsurancePaymentsMinor = movementTotal(insurancePayments, 'bank')
  const expected = shift.openingCashMinor + cashSales - cashRefunds + cashInsuranceReceiptsMinor - cashInsurancePaymentsMinor
  return {
    invoiceCount: mySales.length,
    returnCount: myReturns.length,
    cashSalesMinor: cashSales,
    bankSalesMinor: bankSales,
    creditSalesMinor: creditSales,
    cashRefundsMinor: cashRefunds,
    cashInsuranceReceiptsMinor, bankInsuranceReceiptsMinor, cashInsurancePaymentsMinor, bankInsurancePaymentsMinor,
    expectedCashMinor: expected,
    varianceMinor: shift.countedCashMinor === null ? null : shift.countedCashMinor - expected,
    grossSalesMinor: grossSales,
    discountsMinor: discounts,
    taxMinor: tax,
    netSalesMinor: netSales,
    returnsTotalMinor: returnsTotal,
    bankRefundsMinor: bankRefunds,
  }
}

/**
 * F2 — صفوف تقرير Z (الإقفال) بالترتيب المطبوع.
 *
 * لماذا دالة خالصة: تقرير الإقفال هو المستند الذي يُطابق عليه المحاسب الدرج
 * بعد نهاية اليوم؛ إن حُسبت أرقامه في الشاشة مرة وفي الطباعة مرة أخرى، اختلف
 * رقمان على نفس الوردية. فيُبنى من نفس `summarizeShift` ويُفحص بالاختبار.
 *
 * الصفوف أرقام فقط (لا صفوف عنوان) كي يخرج الإيصال الحراري نظيفاً؛ ورقم Z
 * وحالة التسوية يُطبعان في حاشية المستند.
 */
export interface ShiftReportRow {
  nameAr: string
  /** القيمة بالقرش — سالبة للمرتجعات والخصومات */
  valueMinor: Minor
}

export function zReportRows(
  shift: Pick<Shift, 'openingCashMinor' | 'countedCashMinor'>,
  summary: ShiftSummary,
): ShiftReportRow[] {
  const variance = summary.varianceMinor ?? 0
  return [
    { nameAr: `إجمالي المبيعات قبل الخصم (${summary.invoiceCount} فاتورة)`, valueMinor: summary.grossSalesMinor ?? 0 },
    { nameAr: 'الخصومات', valueMinor: -(summary.discountsMinor ?? 0) },
    { nameAr: 'صافي المبيعات', valueMinor: summary.netSalesMinor ?? 0 },
    { nameAr: 'ض.ق.م المحصلة', valueMinor: summary.taxMinor ?? 0 },
    { nameAr: `مرتجعات (${summary.returnCount}) — الإجمالي`, valueMinor: -(summary.returnsTotalMinor ?? 0) },
    { nameAr: 'منها على البنك/المحافظ', valueMinor: -(summary.bankRefundsMinor ?? 0) },
    { nameAr: 'محصل نقداً في الدرج', valueMinor: summary.cashSalesMinor },
    { nameAr: 'محصل على بنوك/محافظ', valueMinor: summary.bankSalesMinor },
    { nameAr: 'الآجل غير المحصل', valueMinor: summary.creditSalesMinor },
    { nameAr: 'تحصيل تأمين نقداً', valueMinor: summary.cashInsuranceReceiptsMinor },
    { nameAr: 'صرف تأمين نقداً', valueMinor: -summary.cashInsurancePaymentsMinor },
    { nameAr: 'رصيد الدرج الافتتاحي', valueMinor: shift.openingCashMinor },
    { nameAr: 'المتوقع في الدرج', valueMinor: summary.expectedCashMinor },
    { nameAr: 'المعدود فعلياً', valueMinor: shift.countedCashMinor ?? 0 },
    {
      nameAr: variance === 0 ? 'الفرق (مضبوط)' : variance < 0 ? 'عجز في الدرج' : 'زيادة في الدرج',
      valueMinor: variance,
    },
  ]
}

/** رقم Z المتسلسل = ترتيب الوردية بين الورديات المقفلة (Z-0001، Z-0002 …) */
export function zReportSequence(shifts: readonly Pick<Shift, 'id' | 'status'>[], shiftId: number): number {
  return shifts.filter((s) => s.status === 'closed' && s.id <= shiftId).length
}

/** التحقق قبل فتح وردية: لا ورديتين مفتوحتين معاً، ولا رصيد سالب */
export function validateOpenShift(openingCashMinor: Minor, shifts: Shift[]): string[] {
  const errors: string[] = []
  // AUDIT-010: قيمة غير رقمية (undefined/NaN/كسر) كانت تمر صامتة فتجعل
  // «المتوقع في الدرج» = NaN وتُفسد فرق الوردية وتسويته — الرفض هنا مبكراً.
  if (!Number.isInteger(openingCashMinor)) errors.push('رصيد الدرج الافتتاحي مطلوب بالقرش الصحيح')
  else if (openingCashMinor < 0) errors.push('رصيد الدرج الافتتاحي لا يكون سالباً')
  if (shifts.some((s) => s.status === 'open')) errors.push('توجد وردية مفتوحة بالفعل — أقفلها أولاً')
  return errors
}

export function currentOpenShift(shifts: Shift[]): Shift | null {
  return shifts.find((s) => s.status === 'open') ?? null
}

/**
 * سياسة الوردية في سياق البيع/الدفع.
 *
 * المالك الرئيسي يرى تلميحاً فقط. المستخدم له override فردي يمكنه إجباره
 * أو إعفاءه، وإذا لم يوجد override يتبع الكاشير الإعداد العام، بينما بقية
 * الأدوار غير مجبرة افتراضياً حتى يستطيع المحاسب/المدير تسجيل بيع آجل أو كبير
 * وتحصيله مباشرة من خزينته. أنشطة «الفاتورة أولاً» خارج هذا السياق.
 */
export interface SalesShiftPolicyInput {
  roleId: string | null | undefined
  isOwner: boolean
  requireOpenShiftForSales: boolean
  userOverride?: boolean | null
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
  if (input.userOverride != null) {
    return {
      required: input.userOverride,
      hintOnly: !input.userOverride,
      messageAr: input.userOverride
        ? 'لا يمكن لهذا المستخدم إتمام البيع أو الدفع قبل فتح وردية مفتوحة — هذا المستخدم مفعّل له الإجبار من الصلاحيات'
        : 'هذا المستخدم غير مجبر على فتح وردية — يمكنه البيع أو الدفع مباشرة من خزينته',
    }
  }
  if (input.roleId === 'cashier') {
    const required = input.requireOpenShiftForSales
    return {
      required,
      hintOnly: !required,
      messageAr: required
        ? 'لا يمكن للكاشير إتمام البيع أو الدفع قبل فتح وردية مفتوحة'
        : 'سياسة الكاشير العامة تسمح بالبيع والدفع بلا وردية مفتوحة',
    }
  }
  return {
    required: false,
    hintOnly: true,
    messageAr: 'هذا المستخدم غير مجبر افتراضياً على فتح وردية — يمكن تفعيل الإجبار له من شاشة الصلاحيات',
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
