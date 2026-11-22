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
import { isValidExpiryDate } from './batches.ts'

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
  /** مصروف مباشر: قيمة الضريبة التي أقر المستخدم بقابليتها للاسترداد ومرجع مستندها. */
  inputVatMinor?: Minor
  taxInvoiceRef?: string
}

/** ملخص ملف عهدة — كل الأرقام محسوبة من الحركات (مصدر حقيقة واحد) */
export interface CustodySummary {
  fundedMinor: Minor // مجموع التعزيزات
  spentMinor: Minor // مصروفات + فواتير (الجزء المحمَّل على العهدة فقط — بلا الزيادة والمرتجع والعجز)
  expenseTotalMinor: Minor // كامل المصروفات الفعلية، شاملاً الجزء الذي دفعه الموظف من جيبه
  excessMinor: Minor // زيادة المصاريف المستحقة للموظف (2107)
  returnedMinor: Minor // المبالغ التي عادت للخزينة عند التسوية
  shortageMinor: Minor // عجز التسوية الذي تحوّل إلى سلفة (1107)
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

/** ملخص الملف من حركاته — الإقفال النقدي والعجز ليسا مصروفاً فعلياً. */
export function summarizeCustody(txs: CustodyTx[]): CustodySummary {
  let funded = 0, spent = 0, excess = 0, returned = 0, shortage = 0
  for (const t of txs) {
    if (t.type === 'fund') funded += t.amountMinor
    else if (t.type === 'expense' || t.type === 'invoice') {
      spent += t.amountMinor - t.excessMinor
      excess += t.excessMinor
    } else if (t.type === 'return') returned += t.amountMinor
    else if (t.type === 'shortage') shortage += t.amountMinor
  }
  return {
    fundedMinor: funded,
    spentMinor: spent,
    expenseTotalMinor: spent + excess,
    excessMinor: excess,
    returnedMinor: returned,
    shortageMinor: shortage,
    remainingMinor: funded - spent - returned - shortage,
    txCount: txs.length,
  }
}

export interface CustodyExcessFileBalance {
  fileId: number
  employeeId: number
  accruedMinor: Minor
  paidMinor: Minor
  remainingMinor: Minor
}

/** الحد الأدنى المطلوب من مسير الرواتب لحساب توزيع مستحقات العهد. */
export interface CustodyExcessPayrollRun {
  id: number
  date: string
  lines: readonly { employeeId: number; excessPaidMinor?: Minor }[]
}

/**
 * يوزّع ما صُرف من مستحقات الزيادة بالمسيرات على ملفات الموظف الأقدم استحقاقاً
 * أولاً. بقيت المدفوعات في المسير مرتبطة بالموظف لأسباب توافقية؛ هذا الملخص
 * يربطها بالملف الصحيح حتى بعد إغلاقه، ويعرض المتبقي لكل ملف دون تكرار إجمالي
 * الموظف على كل ملف.
 */
export function summarizeCustodyExcessAllocation(
  files: readonly Pick<CustodyFile, 'id' | 'employeeId'>[],
  txs: readonly Pick<CustodyTx, 'id' | 'fileId' | 'date' | 'excessMinor'>[],
  payrollRuns: readonly CustodyExcessPayrollRun[],
): { balances: Map<number, CustodyExcessFileBalance>; unallocatedPaidByEmployee: Map<number, Minor> } {
  const fileById = new Map(files.map((file) => [file.id, file]))
  const balances = new Map<number, CustodyExcessFileBalance>(files.map((file) => [file.id, {
    fileId: file.id, employeeId: file.employeeId, accruedMinor: 0, paidMinor: 0, remainingMinor: 0,
  }]))
  const chargeRows = txs
    .filter((tx) => tx.excessMinor > 0 && fileById.has(tx.fileId))
    .slice()
    // الحركات القديمة لا تحمل ساعة موثوقة؛ ترتيب اليوم بالمعرّف لا بمقارنة صيغ تاريخ مختلفة.
    .sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) || a.id - b.id)
    .map((tx) => ({ fileId: tx.fileId, employeeId: fileById.get(tx.fileId)!.employeeId, date: tx.date.slice(0, 10), remainingMinor: tx.excessMinor }))
  const chargesByEmployee = new Map<number, typeof chargeRows>()
  for (const charge of chargeRows) {
    const rows = chargesByEmployee.get(charge.employeeId) ?? []
    rows.push(charge)
    chargesByEmployee.set(charge.employeeId, rows)
    const balance = balances.get(charge.fileId)!
    balance.accruedMinor += charge.remainingMinor
    balance.remainingMinor += charge.remainingMinor
  }

  const runCursorByEmployee = new Map<number, number>()
  const unallocatedPaidByEmployee = new Map<number, Minor>()
  const orderedRuns = payrollRuns.slice().sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) || a.id - b.id)
  for (const run of orderedRuns) {
    for (const line of run.lines) {
      let toApply = line.excessPaidMinor ?? 0
      if (!Number.isInteger(toApply) || toApply <= 0) continue
      const charges = chargesByEmployee.get(line.employeeId) ?? []
      let cursor = runCursorByEmployee.get(line.employeeId) ?? 0
      while (toApply > 0 && cursor < charges.length) {
        const charge = charges[cursor]
        // لا يخصَّص صرف قديم لاستحقاق لم ينشأ بعده؛ الفائض غير المثبت لا يُرحَّل للمستقبل.
        if (charge.date > run.date.slice(0, 10)) break
        if (charge.remainingMinor <= 0) { cursor++; continue }
        const take = Math.min(charge.remainingMinor, toApply)
        charge.remainingMinor -= take
        toApply -= take
        const balance = balances.get(charge.fileId)!
        balance.paidMinor += take
        balance.remainingMinor -= take
        if (charge.remainingMinor === 0) cursor++
      }
      runCursorByEmployee.set(line.employeeId, cursor)
      if (toApply > 0) unallocatedPaidByEmployee.set(line.employeeId, (unallocatedPaidByEmployee.get(line.employeeId) ?? 0) + toApply)
    }
  }
  return { balances, unallocatedPaidByEmployee }
}

/** توافق المستدعين القدامى؛ الأرصدة محسوبة ولا تمثل تخصيصاً تاريخياً مثبتاً. */
export function summarizeCustodyExcessByFile(
  files: readonly Pick<CustodyFile, 'id' | 'employeeId'>[],
  txs: readonly Pick<CustodyTx, 'id' | 'fileId' | 'date' | 'excessMinor'>[],
  payrollRuns: readonly CustodyExcessPayrollRun[],
): Map<number, CustodyExcessFileBalance> {
  return summarizeCustodyExcessAllocation(files, txs, payrollRuns).balances
}

/** فحص محافظ لرصيد ملف مفتوح قبل حركة مباشرة، وليس مطابقة لقيود كل المستندات المشتركة. */
export function checkedOpenCustodySummary(file: CustodyFile, txs: readonly CustodyTx[], today: string): CustodySummary {
  const fail = (): never => { throw new Error('حركات العهدة أو ترتيبها غير صالح — راجع الملف والقيود قبل الحركة') }
  if (!isValidExpiryDate(today) || typeof file.openedAt !== 'string' || !isValidExpiryDate(file.openedAt) || file.openedAt > today) return fail()
  if (file.status !== 'open' || file.settledAt != null || file.returnedMinor !== 0 || file.shortageMinor !== 0) return fail()
  const seen = new Set<number>()
  let balance = 0
  for (const tx of txs) {
    if (!tx || tx.fileId !== file.id || !Number.isSafeInteger(tx.id) || tx.id <= 0 || seen.has(tx.id) || !Number.isSafeInteger(tx.amountMinor) || tx.amountMinor <= 0 || !Number.isSafeInteger(tx.excessMinor) || tx.excessMinor < 0 || tx.excessMinor > tx.amountMinor || typeof tx.date !== 'string' || !isValidExpiryDate(tx.date.slice(0, 10)) || tx.date.slice(0, 10) < file.openedAt || tx.date.slice(0, 10) > today) return fail()
    seen.add(tx.id)
    if (tx.type === 'fund') {
      if (tx.excessMinor !== 0) return fail()
      balance += tx.amountMinor
    } else if (tx.type === 'expense' || tx.type === 'invoice') {
      if (tx.type === 'invoice' && tx.excessMinor !== 0) return fail()
      balance -= tx.amountMinor - tx.excessMinor
    } else return fail() // لا يمكن أن يبقى الملف مفتوحاً بعد تسوية أو حركة مجهولة
    if (!Number.isSafeInteger(balance) || balance < 0) return fail()
  }
  const summary = summarizeCustody([...txs])
  if (Object.values(summary).some(value => !Number.isSafeInteger(value)) || summary.remainingMinor !== balance) return fail()
  return summary
}

/** قيد تمويل/تعزيز العهدة: مدين 1108 ← دائن الخزينة المختارة */
export function buildCustodyFundEntry(amountMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ التعزيز يجب أن يكون عدداً صحيحاً آمناً وموجباً')
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
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('مبلغ المصروف يجب أن يكون عدداً صحيحاً آمناً وموجباً')
  if (!Number.isSafeInteger(remainingMinor) || remainingMinor < 0) throw new Error('رصيد العهدة غير سليم')
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
  inputVatMinor: Minor = 0,
): JournalLine[] {
  const total = fromCustodyMinor + excessMinor
  if (![fromCustodyMinor, excessMinor, total, inputVatMinor].every(Number.isSafeInteger)) throw new Error('قيم المصروف والضريبة يجب أن تكون أعداداً صحيحة آمنة')
  if (total <= 0) throw new Error('مبلغ المصروف يجب أن يكون موجباً')
  if (fromCustodyMinor < 0 || excessMinor < 0) throw new Error('قيم المصروف لا تكون سالبة')
  if (inputVatMinor < 0 || inputVatMinor >= total) throw new Error('ضريبة المدخلات يجب أن تكون غير سالبة وأقل من إجمالي المصروف')
  const lines: JournalLine[] = [
    { accountCode: expenseAccount, debit: total - inputVatMinor, credit: 0, note: label },
  ]
  if (inputVatMinor > 0) lines.push({ accountCode: '2102', debit: inputVatMinor, credit: 0, note: 'ضريبة مدخلات مصروف العهدة' })
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
  if (!Number.isSafeInteger(remainingMinor) || remainingMinor < 0) throw new Error('رصيد العهدة غير سليم')
  if (!Number.isSafeInteger(returnedMinor) || returnedMinor < 0) throw new Error('المرتجع النقدي يجب أن يكون عدداً صحيحاً آمناً وغير سالب')
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
