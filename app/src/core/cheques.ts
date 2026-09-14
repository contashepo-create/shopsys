/**
 * الشيكات (أوراق القبض والدفع) — تَحَكَّم (TAHAKAM ERP)
 * ─────────────────────────────────────────
 * دورة حياة كاملة بقيود متوازنة في نفس دفتر الأستاذ (القرار 9):
 *
 * شيك وارد (من عميل — ورقة قبض):
 *   استلام:   مدين 1106 أوراق قبض ← دائن 1104 العملاء (تخفيض مديونيته)
 *   إيداع:    حالة فقط (تحت التحصيل) — لا قيد، الورقة ما زالت أصلاً بنفس القيمة
 *   تحصيل:   مدين 1102 البنوك ← دائن 1106 أوراق قبض
 *   ارتداد:   قيد عاكس للاستلام — يعود الدين على العميل ويُسجل الارتداد بتاريخه
 *
 * شيك صادر (لمورد — ورقة دفع):
 *   تحرير:    مدين 2101 الموردون (تخفيض ديننا) ← دائن 2106 أوراق دفع
 *   صرف:      مدين 2106 أوراق دفع ← دائن 1102 البنوك
 *   إلغاء:    قيد عاكس للتحرير (قبل الصرف فقط) — يعود الدين للمورد
 *
 * لا نقود عائمة: كل المبالغ Minor صحيحة، وكل تحول حالة موثق بتاريخه.
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

/* ─── الأنواع ─── */

export type ChequeDirection = 'incoming' | 'outgoing'

export type ChequeStatus =
  | 'held'      // وارد: في الحافظة بانتظار الإيداع
  | 'deposited' // وارد: أودع بالبنك — تحت التحصيل
  | 'collected' // وارد: حُصّل ودخل البنك (نهائية)
  | 'bounced'   // وارد: ارتد (نهائية — الدين عاد على العميل)
  | 'issued'    // صادر: حُرر وسُلّم للمورد بانتظار الصرف
  | 'cleared'   // صادر: صُرف من حسابنا البنكي (نهائية)
  | 'cancelled' // صادر: أُلغي قبل الصرف (نهائية — الدين عاد للمورد)

export interface Cheque {
  id: number
  chequeNumber: string      // رقم الورقة كما هو مطبوع عليها
  direction: ChequeDirection
  partyId: number           // عميل (وارد) أو مورد (صادر)
  partyName: string
  bankName: string          // البنك المسحوب عليه
  amountMinor: Minor
  dueDate: string           // تاريخ الاستحقاق ISO (yyyy-mm-dd)
  status: ChequeStatus
  notes: string
  createdAt: string
  receiveEntryId: number    // قيد الاستلام/التحرير
  settleEntryId: number | null  // قيد التحصيل/الصرف
  reverseEntryId: number | null // قيد الارتداد/الإلغاء
  depositedAt: string | null
  settledAt: string | null      // تاريخ التحصيل/الصرف/الارتداد/الإلغاء
}

export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  held: 'في الحافظة',
  deposited: 'تحت التحصيل',
  collected: 'حُصِّل ✓',
  bounced: 'مرتد ✗',
  issued: 'بانتظار الصرف',
  cleared: 'صُرِف ✓',
  cancelled: 'ملغي',
}

/* حسابات النظام المستخدمة */
export const NOTES_RECEIVABLE = '1106' // أوراق قبض
export const NOTES_PAYABLE = '2106'    // أوراق دفع
const CUSTOMERS = '1104'
const SUPPLIERS = '2101'
const BANK = '1102'

/* ─── التحقق ─── */

export function validateCheque(args: {
  chequeNumber: string
  amountMinor: Minor
  dueDate: string
  partyId: number
}): void {
  if (!args.chequeNumber.trim()) throw new Error('رقم الشيك مطلوب')
  if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('مبلغ الشيك يجب أن يكون موجباً')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) throw new Error('تاريخ الاستحقاق غير صالح')
  if (!Number.isInteger(args.partyId) || args.partyId <= 0) throw new Error('اختر الطرف (عميل/مورد)')
}

/* ─── بناء القيود (نقية — ترمي لو غير متوازنة) ─── */

/** استلام شيك وارد من عميل: 1106 ← 1104 */
export function buildChequeReceiveEntry(amountMinor: Minor, note: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: NOTES_RECEIVABLE, debit: amountMinor, credit: 0, note },
    { accountCode: CUSTOMERS, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/** تحصيل شيك وارد: 1102 ← 1106 */
export function buildChequeCollectEntry(amountMinor: Minor, note: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: BANK, debit: amountMinor, credit: 0, note },
    { accountCode: NOTES_RECEIVABLE, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/** ارتداد شيك وارد: عكس الاستلام — 1104 ← 1106 (الدين يعود على العميل) */
export function buildChequeBounceEntry(amountMinor: Minor, note: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: CUSTOMERS, debit: amountMinor, credit: 0, note },
    { accountCode: NOTES_RECEIVABLE, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/** تحرير شيك صادر لمورد: 2101 ← 2106 */
export function buildChequeIssueEntry(amountMinor: Minor, note: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: SUPPLIERS, debit: amountMinor, credit: 0, note },
    { accountCode: NOTES_PAYABLE, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/** صرف شيك صادر من البنك: 2106 ← 1102 */
export function buildChequeClearEntry(amountMinor: Minor, note: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: NOTES_PAYABLE, debit: amountMinor, credit: 0, note },
    { accountCode: BANK, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/** إلغاء شيك صادر قبل صرفه: عكس التحرير — 2106 ← 2101 (الدين يعود للمورد) */
export function buildChequeCancelEntry(amountMinor: Minor, note: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: NOTES_PAYABLE, debit: amountMinor, credit: 0, note },
    { accountCode: SUPPLIERS, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── آلة الحالات: التحولات المسموحة فقط ─── */

const TRANSITIONS: Record<ChequeStatus, ChequeStatus[]> = {
  held: ['deposited', 'collected', 'bounced'],
  deposited: ['collected', 'bounced'],
  collected: [],
  bounced: [],
  issued: ['cleared', 'cancelled'],
  cleared: [],
  cancelled: [],
}

export function assertTransition(from: ChequeStatus, to: ChequeStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`لا يمكن نقل الشيك من «${CHEQUE_STATUS_LABELS[from]}» إلى «${CHEQUE_STATUS_LABELS[to]}»`)
  }
}

/** الحالات النهائية — لا رجعة بعدها */
export function isFinalStatus(s: ChequeStatus): boolean {
  return TRANSITIONS[s].length === 0
}

/* ─── تنبيهات الاستحقاق ─── */

export interface ChequeAlert {
  cheque: Cheque
  daysLeft: number // سالب = متأخر
}

/**
 * الشيكات المستحقة خلال أيام قادمة أو المتأخرة — للشيكات المفتوحة فقط
 * (وارد: بالحافظة/تحت التحصيل — صادر: بانتظار الصرف)
 */
export function dueCheques(cheques: Cheque[], todayIso: string, withinDays = 7): ChequeAlert[] {
  const today = Date.parse(todayIso.slice(0, 10))
  return cheques
    .filter((c) => !isFinalStatus(c.status))
    .map((c) => ({ cheque: c, daysLeft: Math.round((Date.parse(c.dueDate) - today) / 86400000) }))
    .filter((a) => a.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

/** ملخص المحفظة: قيمة الأوراق المفتوحة بكل اتجاه */
export function chequePortfolio(cheques: Cheque[]): {
  incomingOpenMinor: Minor; incomingOpenCount: number
  outgoingOpenMinor: Minor; outgoingOpenCount: number
  bouncedCount: number
} {
  let inM = 0, inC = 0, outM = 0, outC = 0, bounced = 0
  for (const c of cheques) {
    if (c.status === 'bounced') bounced++
    if (isFinalStatus(c.status)) continue
    if (c.direction === 'incoming') { inM += c.amountMinor; inC++ }
    else { outM += c.amountMinor; outC++ }
  }
  return { incomingOpenMinor: inM, incomingOpenCount: inC, outgoingOpenMinor: outM, outgoingOpenCount: outC, bouncedCount: bounced }
}
