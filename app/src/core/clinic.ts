/**
 * وحدة محاسبة الأطباء / العيادات (القرار 27) — نواة خالصة
 * ────────────────────────────────────────────────────────
 * ملف لكل مريض: بيانات + تاريخ طبي، وكل زيارة (كشف/استشارة/إجراء/متابعة)
 * تُسجل بملاحظات الطبيب (شكوى/تشخيص/علاج) وقيمتها، مع خطط علاج
 * متعددة الجلسات (أسنان مثلاً) ومواعيد قادمة.
 *
 * المحاسبة: قيد الزيارة 1101|1104 ← 4108 إيراد كشف وعلاج + 2102 ضريبة،
 * والسداد الجزئي مدعوم (المتبقي على حساب المريض 1104).
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

/* ─── أنواع الزيارات ─── */

export type VisitKind = 'checkup' | 'consultation' | 'procedure' | 'followup'

export const VISIT_KIND_LABELS: Record<VisitKind, { nameAr: string; icon: string }> = {
  checkup: { nameAr: 'كشف', icon: '🩺' },
  consultation: { nameAr: 'استشارة', icon: '💬' },
  procedure: { nameAr: 'إجراء / جلسة علاج', icon: '🦷' },
  followup: { nameAr: 'متابعة (إعادة)', icon: '🔄' },
}

export interface VisitInput {
  kind: VisitKind
  feeMinor: Minor // قيمة الزيارة
  paidMinor: Minor // المسدد فعلاً (الباقي دين على المريض)
  vatPercent: number // كثير من الدول تعفي الخدمات الطبية — تمرر 0
}

export interface VisitTotals {
  feeMinor: Minor
  vatMinor: Minor
  totalMinor: Minor
  paidMinor: Minor
  dueMinor: Minor // المتبقي على المريض
}

export function computeVisitTotals(v: VisitInput): VisitTotals {
  if (!Number.isInteger(v.feeMinor) || v.feeMinor <= 0) throw new Error('قيمة الزيارة يجب أن تكون موجبة')
  if (!Number.isInteger(v.paidMinor) || v.paidMinor < 0) throw new Error('المسدد لا يكون سالباً')
  if (v.vatPercent < 0 || v.vatPercent > 100) throw new Error('نسبة الضريبة بين 0 و100')
  const vat = Math.round((v.feeMinor * v.vatPercent) / 100)
  const total = v.feeMinor + vat
  if (v.paidMinor > total) throw new Error('المسدد أكبر من إجمالي الزيارة')
  return { feeMinor: v.feeMinor, vatMinor: vat, totalMinor: total, paidMinor: v.paidMinor, dueMinor: total - v.paidMinor }
}

/**
 * قيد الزيارة المتوازن — يدعم السداد الجزئي:
 *   من ح/ 1101 المسدد + 1104 المتبقي ← إلى ح/ 4108 الإيراد + 2102 الضريبة
 */
export function buildVisitEntry(t: VisitTotals, label: string): JournalLine[] {
  const lines: JournalLine[] = []
  if (t.paidMinor > 0) lines.push({ accountCode: '1101', debit: t.paidMinor, credit: 0, note: `تحصيل ${label}` })
  if (t.dueMinor > 0) lines.push({ accountCode: '1104', debit: t.dueMinor, credit: 0, note: 'متبقٍ على المريض' })
  lines.push({ accountCode: '4108', debit: 0, credit: t.feeMinor, note: 'إيراد كشف وعلاج' })
  if (t.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: t.vatMinor, note: 'ض.ق.م' })
  assertBalanced(lines)
  return lines
}

/** قيد تحصيل متأخرات مريض: 1101 ← 1104 */
export function buildPatientCollectionEntry(amountMinor: Minor, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ التحصيل يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: '1101', debit: amountMinor, credit: 0, note: `تحصيل من ${label}` },
    { accountCode: '1104', debit: 0, credit: amountMinor, note: 'تخفيض مديونية المريض' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── خطط العلاج (جلسات متعددة — أسنان وجلدية وعلاج طبيعي) ─── */

export interface TreatmentPlanInput {
  totalSessions: number
  totalFeeMinor: Minor // إجمالي الخطة
}

export function validateTreatmentPlan(p: TreatmentPlanInput): string[] {
  const errors: string[] = []
  if (!Number.isInteger(p.totalSessions) || p.totalSessions < 2) errors.push('خطة العلاج جلستان على الأقل (الجلسة الواحدة سجلها زيارة عادية)')
  if (!Number.isInteger(p.totalFeeMinor) || p.totalFeeMinor <= 0) errors.push('قيمة الخطة يجب أن تكون موجبة')
  return errors
}

/** قسمة قيمة الخطة على الجلسات بلا فقد قرش (المتبقي يذهب للجلسة الأخيرة) */
export function sessionFees(totalFeeMinor: Minor, totalSessions: number): Minor[] {
  const base = Math.floor(totalFeeMinor / totalSessions)
  const fees = Array.from({ length: totalSessions }, () => base)
  fees[totalSessions - 1] += totalFeeMinor - base * totalSessions
  return fees
}

/* ─── رصيد المريض وملفه ─── */

/** رصيد مريض = مجموع المتبقي من زياراته − تحصيلاته اللاحقة */
export function patientBalance(
  visits: readonly { dueMinor: Minor }[],
  collections: readonly { amountMinor: Minor }[],
): Minor {
  const due = visits.reduce((a, v) => a + v.dueMinor, 0)
  const collected = collections.reduce((a, c) => a + c.amountMinor, 0)
  return due - collected
}

/** ملخص ملف المريض للعرض */
export function patientFileSummary(
  visits: readonly { kind: VisitKind; feeMinor: Minor; dueMinor: Minor; date: string }[],
): { visitCount: number; totalFeesMinor: Minor; lastVisit: string | null; byKind: Record<VisitKind, number> } {
  const byKind: Record<VisitKind, number> = { checkup: 0, consultation: 0, procedure: 0, followup: 0 }
  let total = 0
  let last: string | null = null
  for (const v of visits) {
    byKind[v.kind]++
    total += v.feeMinor
    if (last === null || v.date > last) last = v.date
  }
  return { visitCount: visits.length, totalFeesMinor: total, lastVisit: last, byKind }
}
