/**
 * العمولات — قسمان بمعالجة محاسبية سليمة (طلب المالك):
 * ─────────────────────────────────────────
 * «عمولات لدى الغير» (earned — لي): أنا أستحق عمولة عند جهة خارجية
 *   استحقاق: مدين 1112 عمولات مستحقة لدى الغير ← دائن 4112 إيراد عمولات
 *   تحصيل:   مدين خزينة/بنك ← دائن 1112
 * «عمولات للغير» (owed — عليّ): جهة خارجية تستحق عمولة عندي
 *   استحقاق: مدين 5113 مصروف عمولات ← دائن 2114 عمولات مستحقة للغير
 *   دفع:      مدين 2114 ← دائن خزينة/بنك
 * والأشخاص/الجهات مسجلون في سجل خاص (CommissionParty) — لا أسماء حرة.
 * معمم على كل الأنشطة: سمسار عقارات، مندوب مبيعات، طبيب محيل، وسيط شحن…
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

export type CommissionDirection = 'earned' | 'owed'

export const COMMISSION_DIRECTION_LABELS: Record<CommissionDirection, { nameAr: string; icon: string; desc: string }> = {
  earned: { nameAr: 'عمولات لدى الغير (لي)', icon: '💰', desc: 'عمولات تستحقها منشأتك عند جهات خارجية — إيراد يُثبت عند الاستحقاق ويُحصَّل لاحقاً' },
  owed: { nameAr: 'عمولات للغير (عليّ)', icon: '📤', desc: 'عمولات يستحقها أشخاص أو جهات على منشأتك — مصروف يُثبت عند الاستحقاق ويُدفع لاحقاً' },
}

/* حسابات النظام */
export const COMMISSION_RECEIVABLE = '1112' // عمولات مستحقة لدى الغير (أصل)
export const COMMISSION_INCOME = '4112'     // إيراد عمولات خارجية
export const COMMISSION_EXPENSE = '5113'    // مصروف عمولات للغير
export const COMMISSION_PAYABLE = '2114'    // عمولات مستحقة للغير (التزام)

/** شخص/جهة عمولات مسجلة — إلزامي قبل تسجيل أي عمولة (طلب المالك) */
export interface CommissionParty {
  id: number
  code: string // CMP-0001
  nameAr: string
  phone: string
  kind: string // سمسار، مندوب، مركز أشعة، شركة شحن… نص حر وصفي
  notes: string
  createdAt: string
}

export function validateCommissionParty(args: { nameAr: string }, existing: CommissionParty[], excludeId?: number): string[] {
  const errors: string[] = []
  const name = args.nameAr.trim()
  if (!name) errors.push('اسم الشخص/الجهة مطلوب')
  if (name && existing.some((p) => p.id !== excludeId && p.nameAr.trim() === name)) errors.push('الاسم مسجل من قبل')
  return errors
}

/* ─── بناء القيود (نقية) ─── */

/** استحقاق عمولة لي عند الغير: 1112 ← 4112 */
export function buildEarnedAccrualEntry(amountMinor: Minor, partyName: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: COMMISSION_RECEIVABLE, debit: amountMinor, credit: 0, note: `عمولة مستحقة لدى ${partyName}` },
    { accountCode: COMMISSION_INCOME, debit: 0, credit: amountMinor, note: 'إيراد عمولات' },
  ]
  assertBalanced(lines)
  return lines
}

/** تحصيل عمولة لي: خزينة/بنك ← 1112 */
export function buildEarnedCollectEntry(amountMinor: Minor, partyName: string, treasury: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: amountMinor, credit: 0, note: 'نقدية واردة' },
    { accountCode: COMMISSION_RECEIVABLE, debit: 0, credit: amountMinor, note: `تحصيل من ${partyName}` },
  ]
  assertBalanced(lines)
  return lines
}

/** استحقاق عمولة عليّ للغير: 5113 ← 2114 */
export function buildOwedAccrualEntry(amountMinor: Minor, partyName: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: COMMISSION_EXPENSE, debit: amountMinor, credit: 0, note: `عمولة مستحقة لـ${partyName}` },
    { accountCode: COMMISSION_PAYABLE, debit: 0, credit: amountMinor, note: `مستحق لـ${partyName}` },
  ]
  assertBalanced(lines)
  return lines
}

/** دفع عمولة عليّ: 2114 ← خزينة/بنك */
export function buildOwedPayEntry(amountMinor: Minor, partyName: string, treasury: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: COMMISSION_PAYABLE, debit: amountMinor, credit: 0, note: `سداد عمولة ${partyName}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'نقدية صادرة' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── تقارير ─── */

export interface CommissionLike {
  direction: CommissionDirection
  partyId: number | null
  partyName: string
  amountMinor: Minor
  collectedMinor: Minor // المحصَّل (لي) أو المدفوع (عليّ)
}

/** ملخص لكل شخص: إجمالي/مُسدَّد/متبقٍ — لقسمٍ واحد */
export function commissionsByParty(rows: CommissionLike[], direction: CommissionDirection): {
  partyId: number | null; partyName: string
  totalMinor: Minor; settledMinor: Minor; remainingMinor: Minor; count: number
}[] {
  const map = new Map<string, { partyId: number | null; partyName: string; totalMinor: number; settledMinor: number; count: number }>()
  for (const r of rows) {
    if (r.direction !== direction) continue
    const key = r.partyId != null ? `id:${r.partyId}` : `nm:${r.partyName}`
    const cur = map.get(key) ?? { partyId: r.partyId, partyName: r.partyName, totalMinor: 0, settledMinor: 0, count: 0 }
    cur.totalMinor += r.amountMinor
    cur.settledMinor += r.collectedMinor
    cur.count++
    map.set(key, cur)
  }
  return [...map.values()]
    .map((v) => ({ ...v, remainingMinor: v.totalMinor - v.settledMinor }))
    .sort((a, b) => b.remainingMinor - a.remainingMinor)
}
