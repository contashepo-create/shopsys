/**
 * محرك ملفات العهد (طلب المالك — مرجعية pro-acc التدقيقية):
 * ─────────────────────────────────────────────────────────
 * - الملف يُفتح أولاً (بلا قيد) ثم تُسجَّل أول عهدة فيه — ويمكن أكثر من ملف لنفس الموظف
 * - كل تمويل/تعزيز: مدين 1108 عهد الموظفين ← دائن الخزينة/البنك المختار
 * - العهدة ذمة باسم الموظف: رصيد كل ملف = تعزيزاته − منصرفاته
 * - المصروف: مدين حساب المصروف ← دائن 1108 (حتى المتبقي) + دائن 2107 للزيادة
 *   (زيادة مصاريف الموظف عن عهدته تُسجَّل له مستحقاً يُصرف مع راتبه)
 * - التسوية: مدين الخزينة (المرتجع نقداً) + مدين 1107 (العجز سلفة تُخصم من
 *   الراتب على دفعات بحرية المالك) ← دائن 1108 بكامل المتبقي
 * - الملف المُسوَّى مغلق نهائياً: لا تمويل ولا مصروف ولا تسوية ثانية
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

/** حسابات النظام لملفات العهد */
export const CUSTODY_ACCOUNT = '1108' // عهد الموظفين (أصل — ذمم بأسمائهم)
export const CUSTODY_EXCESS_ACCOUNT = '2107' // مستحق للموظفين (زيادة مصاريف عن العهدة)
export const CUSTODY_SHORTAGE_ACCOUNT = '1107' // سلف الموظفين (عجز العهدة يصير سلفة)

export type CustodyFileStatus = 'open' | 'settled'

export interface CustodyFile {
  id: number
  fileNumber: string // عهدة-2026-0001
  employeeId: number
  projectId: number | null // ربط اختياري بمشروع مقاولات
  reason: string // سبب فتح الملف (عهدة موقع، مشتريات نثرية…)
  notes: string
  openedAt: string // ISO date
  status: CustodyFileStatus
  settledAt: string | null
  /** نتائج التسوية (تُملأ عند الإغلاق فقط) */
  returnedMinor: Minor // المرتجع نقداً للخزينة
  shortageMinor: Minor // العجز — تحول لسلفة على الموظف (1107)
  settleTreasury: string | null // خزينة استلام المرتجع
}

export type CustodyTxType = 'fund' | 'expense' | 'invoice' | 'return' | 'shortage'

export const CUSTODY_TX_LABELS: Record<CustodyTxType, { nameAr: string; icon: string }> = {
  fund: { nameAr: 'تعزيز عهدة', icon: '💰' },
  expense: { nameAr: 'مصروف من العهدة', icon: '🧾' },
  invoice: { nameAr: 'فاتورة شراء من العهدة', icon: '📄' },
  return: { nameAr: 'مرتجع نقدي عند التسوية', icon: '↩️' },
  shortage: { nameAr: 'عجز عهدة (سلفة على الموظف)', icon: '⚠️' },
}

/** حركة على ملف عهدة — كل حركة مالية مربوطة بقيدها */
export interface CustodyTx {
  id: number
  fileId: number
  type: CustodyTxType
  date: string
  amountMinor: Minor
  /** للزيادة المسموحة في المصروف: الجزء المحمَّل على 2107 (ضمن amountMinor) */
  excessMinor: Minor
  description: string
  treasury: string | null // للتمويل والمرتجع: الخزينة/البنك الطرف الآخر
  projectId: number | null // مصروف مربوط بمشروع → يدخل تكاليفه وربحيته
  purchaseId: number | null // فاتورة شراء سُددت من العهدة
  journalEntryId: number | null
}

/** ملخص ملف عهدة — كل الأرقام محسوبة من الحركات (مصدر حقيقة واحد) */
export interface CustodySummary {
  fundedMinor: Minor // مجموع التعزيزات
  spentMinor: Minor // مصروفات + فواتير (الجزء المحمَّل على العهدة فقط — بلا الزيادة)
  excessMinor: Minor // زيادة المصاريف المستحقة للموظف (2107)
  remainingMinor: Minor // المتبقي بعهدة الموظف
  txCount: number
}

export function custodyFileNumber(id: number, openedAt: string): string {
  return `عهدة-${openedAt.slice(0, 4)}-${String(id).padStart(4, '0')}`
}

export function validateCustodyFile(args: { employeeId: number; reason: string }): string[] {
  const errors: string[] = []
  if (!args.employeeId) errors.push('اختر الموظف صاحب العهدة')
  if (!args.reason.trim()) errors.push('اكتب سبب فتح الملف (عهدة موقع، مشتريات نثرية…)')
  return errors
}

/** ملخص الملف من حركاته — الزيادة لا تُحسب على العهدة (محمّلة على 2107) */
export function summarizeCustody(txs: CustodyTx[]): CustodySummary {
  let funded = 0, spent = 0, excess = 0
  for (const t of txs) {
    if (t.type === 'fund') funded += t.amountMinor
    else if (t.type === 'expense' || t.type === 'invoice') {
      spent += t.amountMinor - t.excessMinor
      excess += t.excessMinor
    } else if (t.type === 'return' || t.type === 'shortage') spent += t.amountMinor
  }
  return { fundedMinor: funded, spentMinor: spent, excessMinor: excess, remainingMinor: funded - spent, txCount: txs.length }
}

/** قيد تمويل/تعزيز العهدة: مدين 1108 ← دائن الخزينة المختارة */
export function buildCustodyFundEntry(amountMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ التعزيز يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: CUSTODY_ACCOUNT, debit: amountMinor, credit: 0, note: `تعزيز ${label}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'صرف من الخزينة للعهدة' },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * تقسيم مصروف على العهدة: ما يغطيه المتبقي يُحمَّل على 1108،
 * والزيادة (بموافقة صريحة allowExcess) تُحمَّل على 2107 مستحقاً للموظف
 */
export function splitCustodyExpense(remainingMinor: Minor, amountMinor: Minor, allowExcess: boolean): { fromCustodyMinor: Minor; excessMinor: Minor } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ المصروف يجب أن يكون موجباً')
  if (amountMinor <= remainingMinor) return { fromCustodyMinor: amountMinor, excessMinor: 0 }
  if (!allowExcess) throw new Error(`المصروف أكبر من رصيد العهدة المتبقي — فعِّل «سماح بالزيادة» لتسجيل الفرق مستحقاً للموظف`)
  if (remainingMinor < 0) throw new Error('رصيد العهدة غير سليم')
  return { fromCustodyMinor: remainingMinor, excessMinor: amountMinor - remainingMinor }
}

/**
 * قيد مصروف من العهدة:
 *   مدين حساب المصروف (بكامل المبلغ) ← دائن 1108 (جزء العهدة) + دائن 2107 (الزيادة)
 */
export function buildCustodyExpenseEntry(
  expenseAccount: string,
  fromCustodyMinor: Minor,
  excessMinor: Minor,
  label: string,
): JournalLine[] {
  const total = fromCustodyMinor + excessMinor
  if (total <= 0) throw new Error('مبلغ المصروف يجب أن يكون موجباً')
  if (fromCustodyMinor < 0 || excessMinor < 0) throw new Error('قيم المصروف لا تكون سالبة')
  const lines: JournalLine[] = [
    { accountCode: expenseAccount, debit: total, credit: 0, note: label },
  ]
  if (fromCustodyMinor > 0) lines.push({ accountCode: CUSTODY_ACCOUNT, debit: 0, credit: fromCustodyMinor, note: 'من عهدة الموظف' })
  if (excessMinor > 0) lines.push({ accountCode: CUSTODY_EXCESS_ACCOUNT, debit: 0, credit: excessMinor, note: 'زيادة مصاريف مستحقة للموظف — تُصرف مع راتبه' })
  assertBalanced(lines)
  return lines
}

/**
 * قيد تسوية/إغلاق الملف: المرتجع نقداً يعود للخزينة والعجز يصير سلفة على الموظف
 *   مدين الخزينة (المرتجع) + مدين 1107 (العجز) ← دائن 1108 بكامل المتبقي
 * يرمي لو المرتجع أكبر من المتبقي — ولو المتبقي صفراً يُقفل الملف بلا قيد (null)
 */
export function buildCustodySettleEntry(
  remainingMinor: Minor,
  returnedMinor: Minor,
  treasury: string,
  label: string,
): JournalLine[] | null {
  if (!Number.isInteger(returnedMinor) || returnedMinor < 0) throw new Error('المرتجع النقدي لا يكون سالباً')
  if (returnedMinor > remainingMinor) throw new Error('المرتجع أكبر من رصيد العهدة المتبقي')
  if (remainingMinor === 0) return null // لا شيء يُسوَّى — إغلاق إداري فقط
  const shortage = remainingMinor - returnedMinor
  const lines: JournalLine[] = []
  if (returnedMinor > 0) lines.push({ accountCode: treasury, debit: returnedMinor, credit: 0, note: `مرتجع ${label}` })
  if (shortage > 0) lines.push({ accountCode: CUSTODY_SHORTAGE_ACCOUNT, debit: shortage, credit: 0, note: `عجز ${label} — سلفة تُخصم من الراتب` })
  lines.push({ accountCode: CUSTODY_ACCOUNT, debit: 0, credit: remainingMinor, note: `تسوية ${label}` })
  assertBalanced(lines)
  return lines
}

/** الملف مفتوح؟ يرمي برسالة عربية واضحة لو مغلقاً (طلب المالك: لا تسوية ولا حركة على ملف مغلق) */
export function assertFileOpen(file: Pick<CustodyFile, 'status' | 'fileNumber'>): void {
  if (file.status !== 'open') throw new Error(`الملف ${file.fileNumber} مُسوَّى ومغلق — افتح ملف عهدة جديداً`)
}

/* ─── مصدر الدفع الموحّد: خزينة/بنك أو ملف عهدة موظف (طلب المالك) ─── */

export type PaySource =
  | { kind: 'treasury'; code: string }
  | { kind: 'custody'; fileId: number }

/** حساب القيد الدائن لمصدر الدفع: خزينة مختارة أو 1108 عهد الموظفين */
export function paySourceAccount(source: PaySource): string {
  return source.kind === 'treasury' ? source.code : CUSTODY_ACCOUNT
}
