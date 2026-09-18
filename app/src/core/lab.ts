/**
 * وحدة معامل التحاليل الطبية (القرار 26) — نواة خالصة
 * ─────────────────────────────────────────────────────
 * دورة العمل: تسجيل طلب (مريض + طبيب مُحيل + فحوصات) ← سحب العينة
 * ← إدخال النتائج (بنطاقات مرجعية حسب السن والجنس وأعلام مرتفع/منخفض)
 * ← اعتماد ← طباعة تقرير النتائج.
 *
 * المحاسبة على المحرك الموحد نفسه (القرار 9):
 * - قيد الطلب: خزينة/عملاء أو شركة تعاقد ← 4106 إيراد تحاليل + 2102 ض.ق.م
 * - عمولة المُحيل: استحقاق 5109 ← 2105 عند الطلب، وصرف 2105 ← 1101 شهرياً
 * كل الأموال أعداد صحيحة (Minor) — لا كسور عائمة.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

/* ─── كتالوج الفحوصات ─── */

export type Gender = 'male' | 'female'

/** نطاق مرجعي: حسب الجنس والعمر — null في الطرف = مفتوح */
export interface RefRange {
  gender: Gender | 'any'
  ageMinYears: number // شامل
  ageMaxYears: number // شامل (999 = بلا حد)
  low: number | null
  high: number | null
  /** القيم الحرجة (معيار CAP/CLIA critical values): تجاوزها يستلزم إبلاغ الطبيب فوراً */
  criticalLow?: number | null
  criticalHigh?: number | null
}

export interface LabTest {
  id: number
  code: string // CBC, FBS, TSH…
  nameAr: string
  category: string // دم، هرمونات، كيمياء…
  sampleType: string // دم وريدي، بول، مسحة…
  unit: string // mg/dL, g/dL… ('' = نتيجة وصفية)
  priceMinor: Minor
  /** تكلفة المستهلكات التقريبية (كيماويات/أنابيب) — للربحية فقط */
  costMinor: Minor
  refRanges: RefRange[]
  isActive: boolean
}

export function validateLabTest(t: Omit<LabTest, 'id' | 'isActive'>, existing: readonly LabTest[], editingId?: number): string[] {
  const errors: string[] = []
  if (!t.nameAr.trim()) errors.push('اسم الفحص مطلوب')
  if (!t.code.trim()) errors.push('كود الفحص مطلوب (مثل CBC)')
  if (existing.some((x) => x.id !== editingId && x.code.trim().toUpperCase() === t.code.trim().toUpperCase())) {
    errors.push(`الكود ${t.code} مستخدم لفحص آخر`)
  }
  if (!Number.isInteger(t.priceMinor) || t.priceMinor <= 0) errors.push('سعر الفحص يجب أن يكون موجباً')
  if (!Number.isInteger(t.costMinor) || t.costMinor < 0) errors.push('التكلفة لا تكون سالبة')
  for (const r of t.refRanges) {
    if (r.ageMinYears < 0 || r.ageMaxYears < r.ageMinYears) errors.push('نطاق عمري غير صحيح')
    if (r.low != null && r.high != null && r.high <= r.low) errors.push('النطاق المرجعي: الأعلى يجب أن يفوق الأدنى')
    if (r.low == null && r.high == null) errors.push('النطاق المرجعي يحتاج حداً أدنى أو أعلى على الأقل')
  }
  return errors
}

/** أنسب نطاق مرجعي لمريض: جنس مطابق يتقدم على any، والعمر داخل المدى */
export function matchRefRange(test: Pick<LabTest, 'refRanges'>, gender: Gender, ageYears: number): RefRange | null {
  const candidates = test.refRanges.filter(
    (r) => (r.gender === gender || r.gender === 'any') && ageYears >= r.ageMinYears && ageYears <= r.ageMaxYears,
  )
  if (!candidates.length) return null
  return candidates.find((r) => r.gender === gender) ?? candidates[0]
}

export type ResultFlag = 'low' | 'high' | 'critical_low' | 'critical_high' | 'normal' | 'none'

/**
 * تقييم نتيجة رقمية مقابل النطاق: منخفض/مرتفع/طبيعي.
 * نتيجة غير رقمية أو بلا نطاق ⇒ none (وصفية — يقرؤها الطبيب).
 * يطبع الأرقام العربية قبل القراءة (درس فاتورة الكاشير).
 */
export function evaluateResult(rawValue: string, range: RefRange | null): ResultFlag {
  const ar = '٠١٢٣٤٥٦٧٨٩'
  const normalized = rawValue.trim().replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace('٫', '.')
  const v = Number(normalized)
  if (!normalized || !Number.isFinite(v) || !range) return 'none'
  // القيم الحرجة أولاً (CAP/CLIA): إبلاغ فوري — أخطر من مجرد خارج النطاق
  if (range.criticalLow != null && v < range.criticalLow) return 'critical_low'
  if (range.criticalHigh != null && v > range.criticalHigh) return 'critical_high'
  if (range.low != null && v < range.low) return 'low'
  if (range.high != null && v > range.high) return 'high'
  return 'normal'
}

/** هل العلامة حرجة؟ (تستلزم إبلاغ الطبيب المعالج فوراً وتوثيق الإبلاغ) */
export function isCriticalFlag(f: ResultFlag): boolean {
  return f === 'critical_low' || f === 'critical_high'
}

/** عمر بالسنين من تاريخ ميلاد حتى تاريخ معين */
export function ageYears(birthDate: string, atIso: string): number {
  const b = new Date(birthDate + 'T00:00:00Z')
  const a = new Date(atIso.slice(0, 10) + 'T00:00:00Z')
  let age = a.getUTCFullYear() - b.getUTCFullYear()
  if (a.getUTCMonth() < b.getUTCMonth() || (a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() < b.getUTCDate())) age--
  return Math.max(0, age)
}

/* ─── الطلب ودورة العينة ─── */

/** حالة الفحص الواحد داخل الطلب */
export type TestStatus = 'pending' | 'collected' | 'resulted' | 'approved'

/** انتقالات مشروعة فقط — لا قفز ولا رجوع (سلامة الدورة) */
export const TEST_TRANSITIONS: Record<TestStatus, TestStatus[]> = {
  pending: ['collected'],
  collected: ['resulted'],
  resulted: ['approved'],
  approved: [],
}

export function canTransition(from: TestStatus, to: TestStatus): boolean {
  return TEST_TRANSITIONS[from].includes(to)
}

/** حالة الطلب مشتقة من فحوصاته — لا تُخزن منفصلة فلا تتناقض */
export type OrderStatus = 'registered' | 'in_progress' | 'ready' | 'approved'

export function deriveOrderStatus(testStatuses: readonly TestStatus[]): OrderStatus {
  if (!testStatuses.length) return 'registered'
  if (testStatuses.every((s) => s === 'approved')) return 'approved'
  if (testStatuses.every((s) => s === 'resulted' || s === 'approved')) return 'ready'
  if (testStatuses.some((s) => s !== 'pending')) return 'in_progress'
  return 'registered'
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, { nameAr: string; color: string }> = {
  registered: { nameAr: 'مسجل', color: 'slate' },
  in_progress: { nameAr: 'جارٍ التنفيذ', color: 'amber' },
  ready: { nameAr: 'نتائج جاهزة (بانتظار الاعتماد)', color: 'sky' },
  approved: { nameAr: 'معتمد', color: 'emerald' },
}

/* ─── التسعير والإجماليات ─── */

export interface LabOrderTotals {
  grossMinor: Minor // مجموع أسعار الفحوصات
  discountMinor: Minor
  netMinor: Minor // بعد الخصم (أساس العمولة)
  vatMinor: Minor // كثير من الدول تعفي التحاليل — تُمرر 0 عندها
  totalMinor: Minor
}

export function computeLabTotals(prices: readonly Minor[], discountPercent: number, vatPercent: number): LabOrderTotals {
  if (discountPercent < 0 || discountPercent > 100) throw new Error('نسبة الخصم بين 0 و100')
  if (vatPercent < 0 || vatPercent > 100) throw new Error('نسبة الضريبة بين 0 و100')
  const gross = prices.reduce((a, p) => {
    if (!Number.isInteger(p) || p <= 0) throw new Error('سعر فحص غير صحيح')
    return a + p
  }, 0)
  const discount = Math.round((gross * discountPercent) / 100)
  const net = gross - discount
  const vat = Math.round((net * vatPercent) / 100)
  return { grossMinor: gross, discountMinor: discount, netMinor: net, vatMinor: vat, totalMinor: net + vat }
}

/**
 * قيد الطلب المتوازن:
 *   من ح/ 1101 خزينة (نقدي) أو 1104 عملاء (آجل — شركة تعاقد أو مريض بحساب)
 *     إلى ح/ 4106 إيرادات تحاليل + 2102 ض.ق.م (إن وجدت)
 */
export function buildLabOrderEntry(totals: LabOrderTotals, payment: 'cash' | 'credit', label: string, treasury = '1101'): JournalLine[] {
  if (totals.netMinor <= 0) throw new Error('قيمة الطلب يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? treasury : '1104', debit: totals.totalMinor, credit: 0, note: `تحصيل ${label}` },
    { accountCode: '4106', debit: 0, credit: totals.netMinor, note: 'إيراد تحاليل طبية' },
  ]
  if (totals.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: totals.vatMinor, note: 'ض.ق.م' })
  assertBalanced(lines)
  return lines
}

/* ─── الأطباء المُحيلون والعمولات ─── */

export interface Referrer {
  id: number
  nameAr: string
  phone: string
  commissionPercent: number // نسبة من صافي الطلب (بعد الخصم قبل الضريبة)
  notes: string
}

export function validateReferrer(r: Omit<Referrer, 'id'>): string[] {
  const errors: string[] = []
  if (!r.nameAr.trim()) errors.push('اسم الطبيب مطلوب')
  if (r.commissionPercent < 0 || r.commissionPercent > 50) errors.push('نسبة العمولة بين 0 و50٪')
  return errors
}

/** عمولة المُحيل من صافي الطلب — تقريب لأقرب وحدة صغرى */
export function commissionFor(netMinor: Minor, commissionPercent: number): Minor {
  if (commissionPercent <= 0) return 0
  return Math.round((netMinor * commissionPercent) / 100)
}

/** قيد استحقاق العمولة (عند الطلب): 5109 مصروف عمولات ← 2105 مستحقة */
export function buildCommissionAccrualEntry(commissionMinor: Minor, label: string): JournalLine[] {
  if (!Number.isInteger(commissionMinor) || commissionMinor <= 0) throw new Error('العمولة يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '5109', debit: commissionMinor, credit: 0, note: `عمولة إحالة ${label}` },
    { accountCode: '2105', debit: 0, credit: commissionMinor, note: 'عمولة طبيب مستحقة' },
  ]
  assertBalanced(lines)
  return lines
}

/** قيد صرف العمولات المتجمعة: 2105 ← 1101 */
export function buildCommissionPayoutEntry(totalMinor: Minor, referrerName: string, treasury = '1101'): JournalLine[] {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) throw new Error('لا عمولات مستحقة للصرف')
  const lines: JournalLine[] = [
    { accountCode: '2105', debit: totalMinor, credit: 0, note: `تصفية عمولات د. ${referrerName}` },
    { accountCode: treasury, debit: 0, credit: totalMinor, note: 'صرف نقدي' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── كشف الطبيب المُحيل ─── */

export interface ReferrerStatementRow {
  orderId: number
  orderNumber: string
  date: string // YYYY-MM-DD
  patientName: string
  netMinor: Minor
  commissionMinor: Minor
  paid: boolean
}

export function referrerStatement(
  orders: readonly {
    id: number
    orderNumber: string
    date: string
    patientName: string
    referrerId: number | null
    totals: LabOrderTotals
    commissionMinor: Minor
    commissionPaid: boolean
  }[],
  referrerId: number,
  period: { from: string; to: string },
): { rows: ReferrerStatementRow[]; totalNetMinor: Minor; totalCommissionMinor: Minor; unpaidCommissionMinor: Minor } {
  const rows: ReferrerStatementRow[] = []
  for (const o of orders) {
    if (o.referrerId !== referrerId) continue
    const d = o.date.slice(0, 10)
    if (d < period.from || d > period.to) continue
    rows.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      date: d,
      patientName: o.patientName,
      netMinor: o.totals.netMinor,
      commissionMinor: o.commissionMinor,
      paid: o.commissionPaid,
    })
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.orderId - b.orderId))
  return {
    rows,
    totalNetMinor: rows.reduce((a, r) => a + r.netMinor, 0),
    totalCommissionMinor: rows.reduce((a, r) => a + r.commissionMinor, 0),
    unpaidCommissionMinor: rows.filter((r) => !r.paid).reduce((a, r) => a + r.commissionMinor, 0),
  }
}

/** كتالوج فحوصات جاهز للبدء — أشهر الفحوصات بأكواد عالمية (الأسعار يعدلها المعمل) */
export const STARTER_TESTS: Omit<LabTest, 'id' | 'isActive' | 'priceMinor' | 'costMinor'>[] = [
  { code: 'CBC', nameAr: 'صورة دم كاملة', category: 'دم', sampleType: 'دم وريدي (EDTA)', unit: '', refRanges: [] },
  { code: 'FBS', nameAr: 'سكر صائم', category: 'كيمياء', sampleType: 'دم وريدي', unit: 'mg/dL', refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 70, high: 100 }] },
  { code: 'HBA1C', nameAr: 'سكر تراكمي', category: 'كيمياء', sampleType: 'دم وريدي (EDTA)', unit: '%', refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 4, high: 5.7 }] },
  { code: 'CREA', nameAr: 'وظائف كلى — كرياتينين', category: 'كيمياء', sampleType: 'دم وريدي', unit: 'mg/dL', refRanges: [{ gender: 'male', ageMinYears: 18, ageMaxYears: 999, low: 0.7, high: 1.3 }, { gender: 'female', ageMinYears: 18, ageMaxYears: 999, low: 0.6, high: 1.1 }] },
  { code: 'ALT', nameAr: 'وظائف كبد — ALT', category: 'كيمياء', sampleType: 'دم وريدي', unit: 'U/L', refRanges: [{ gender: 'male', ageMinYears: 0, ageMaxYears: 999, low: null, high: 41 }, { gender: 'female', ageMinYears: 0, ageMaxYears: 999, low: null, high: 33 }] },
  { code: 'TSH', nameAr: 'غدة درقية — TSH', category: 'هرمونات', sampleType: 'دم وريدي', unit: 'mIU/L', refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 0.4, high: 4.2 }] },
  { code: 'LIPID', nameAr: 'دهون كاملة', category: 'كيمياء', sampleType: 'دم وريدي (صائم 12 ساعة)', unit: 'mg/dL', refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: null, high: 200 }] },
  { code: 'URINE', nameAr: 'تحليل بول كامل', category: 'بول وبراز', sampleType: 'بول', unit: '', refRanges: [] },
  { code: 'CRP', nameAr: 'دلالات التهاب — CRP', category: 'مناعة', sampleType: 'دم وريدي', unit: 'mg/L', refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: null, high: 5 }] },
  { code: 'VITD', nameAr: 'فيتامين د', category: 'هرمونات', sampleType: 'دم وريدي', unit: 'ng/mL', refRanges: [{ gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 30, high: 100 }] },
]

/* ─── جولة مراجعة المعمل (الطلبات 6–9): السجل التراكمي للنتائج ─── */

/** صف بسجل نتائج المريض التراكمي لفحص واحد عبر الطلبات */
export interface ResultHistoryRow {
  orderNumber: string
  date: string
  resultValue: string
  resultFlag: ResultFlag
  refLow: number | null
  refHigh: number | null
}

/**
 * السجل التراكمي لنتائج مريض في فحص محدد (Delta Check كما بأنظمة المعامل):
 * كل النتائج المُدخلة (resulted/approved) عبر الطلبات مرتبة من الأحدث للأقدم.
 */
export function patientResultHistory(
  orders: readonly {
    orderNumber: string
    date: string
    patientId: number
    tests: readonly { testId: number; status: TestStatus; resultValue: string; resultFlag: ResultFlag; refLow: number | null; refHigh: number | null }[]
  }[],
  patientId: number,
  testId: number,
): ResultHistoryRow[] {
  const rows: ResultHistoryRow[] = []
  for (const o of orders) {
    if (o.patientId !== patientId) continue
    for (const t of o.tests) {
      if (t.testId !== testId) continue
      if (t.status !== 'resulted' && t.status !== 'approved') continue
      if (!t.resultValue.trim()) continue
      rows.push({ orderNumber: o.orderNumber, date: o.date, resultValue: t.resultValue, resultFlag: t.resultFlag, refLow: t.refLow, refHigh: t.refHigh })
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
}

/**
 * فرق النتيجة عن السابقة (Delta): نسبة التغير المئوية إن كانت القيمتان رقميتين —
 * null إذا تعذر (نص، أو لا سابقة، أو السابقة صفر).
 */
export function resultDeltaPercent(current: string, previous: string): number | null {
  const c = Number(current)
  const p = Number(previous)
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10
}
