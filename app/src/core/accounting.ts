/**
 * أدوات المحاسبة العامة — ShopSys (المرحلة 4)
 * ─────────────────────────────────────────────
 * ميزان المراجعة، قائمة الدخل، سندات القبض والصرف والتحويل بين الخزائن،
 * والتحقق من القيد اليدوي — كلها فوق نفس محرك القيود (القرار 9).
 */
import type { Minor } from './money.ts'
import type { Account, JournalEntry, JournalLine } from './ledger.ts'
import { assertBalanced, accountBalance } from './ledger.ts'

/* ─── ميزان المراجعة ─── */

export interface TrialRow {
  code: string
  nameAr: string
  totalDebit: Minor
  totalCredit: Minor
  balanceDebit: Minor // الرصيد في جانب المدين (إن كان مديناً)
  balanceCredit: Minor // الرصيد في جانب الدائن (إن كان دائناً)
}

export interface TrialBalance {
  rows: TrialRow[] // الحسابات المتحركة فقط
  totalDebit: Minor
  totalCredit: Minor
  balanceDebitTotal: Minor
  balanceCreditTotal: Minor
  balanced: boolean // إجمالي المدين = إجمالي الدائن (يجب أن يكون true دائماً)
}

/** ميزان مراجعة بالمجاميع والأرصدة — الحسابات المتحركة فقط */
export function computeTrialBalance(journal: JournalEntry[], coa: Account[]): TrialBalance {
  const totals = new Map<string, { d: Minor; c: Minor }>()
  for (const e of journal) {
    for (const l of e.lines) {
      const t = totals.get(l.accountCode) ?? { d: 0, c: 0 }
      t.d += l.debit
      t.c += l.credit
      totals.set(l.accountCode, t)
    }
  }
  const rows: TrialRow[] = []
  let td = 0, tc = 0, bd = 0, bc = 0
  // بترتيب الشجرة القياسية
  for (const acc of coa) {
    const t = totals.get(acc.code)
    if (!t || (t.d === 0 && t.c === 0)) continue
    const net = t.d - t.c
    const row: TrialRow = {
      code: acc.code,
      nameAr: acc.nameAr,
      totalDebit: t.d,
      totalCredit: t.c,
      balanceDebit: net > 0 ? net : 0,
      balanceCredit: net < 0 ? -net : 0,
    }
    rows.push(row)
    td += t.d; tc += t.c; bd += row.balanceDebit; bc += row.balanceCredit
  }
  return { rows, totalDebit: td, totalCredit: tc, balanceDebitTotal: bd, balanceCreditTotal: bc, balanced: td === tc }
}

/* ─── قائمة الدخل ─── */

export interface IncomeStatement {
  revenueRows: { code: string; nameAr: string; amount: Minor }[]
  expenseRows: { code: string; nameAr: string; amount: Minor }[]
  totalRevenue: Minor
  totalExpenses: Minor
  netIncome: Minor // موجب = ربح، سالب = خسارة
}

/** قائمة دخل من دفتر الأستاذ (اختيارياً ضمن فترة تواريخ شاملة) */
export function computeIncomeStatement(
  journal: JournalEntry[],
  coa: Account[],
  from?: string,
  to?: string,
): IncomeStatement {
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to)
  const totals = new Map<string, { d: Minor; c: Minor }>()
  for (const e of journal) {
    if (!inRange(e.date)) continue
    for (const l of e.lines) {
      const t = totals.get(l.accountCode) ?? { d: 0, c: 0 }
      t.d += l.debit
      t.c += l.credit
      totals.set(l.accountCode, t)
    }
  }
  const revenueRows: IncomeStatement['revenueRows'] = []
  const expenseRows: IncomeStatement['expenseRows'] = []
  let rev = 0, exp = 0
  for (const acc of coa) {
    if (!acc.isPostable) continue
    const t = totals.get(acc.code)
    if (!t) continue
    if (acc.rootType === 'revenue') {
      const amount = accountBalance('revenue', t.d, t.c)
      if (amount !== 0) { revenueRows.push({ code: acc.code, nameAr: acc.nameAr, amount }); rev += amount }
    } else if (acc.rootType === 'expenses') {
      const amount = accountBalance('expenses', t.d, t.c)
      if (amount !== 0) { expenseRows.push({ code: acc.code, nameAr: acc.nameAr, amount }); exp += amount }
    }
  }
  return { revenueRows, expenseRows, totalRevenue: rev, totalExpenses: exp, netIncome: rev - exp }
}

/* ─── السندات: قبض / صرف / تحويل بين الخزائن ─── */

export type VoucherKind = 'receipt' | 'payment' | 'transfer'
/**
 * كود حساب خزينة/بنك — كان '1101'|'1102' فقط، والآن يدعم خزائن وبنوكاً متعددة
 * بلا حدود (1101، 1102، 1121، 1122…) — كلها حسابات نقدية ورقية تحت «11»
 */
export type TreasuryAccount = string

/**
 * سند قبض: نقدية داخلة —
 *   مدين: الخزينة/البنك، دائن: الحساب المقابل (عميل سداد دين، إيراد، رأس مال…)
 */
export function buildReceiptVoucherEntry(
  treasury: TreasuryAccount,
  counterAccountCode: string,
  amountMinor: Minor,
  note: string,
): JournalLine[] {
  if (amountMinor <= 0) throw new RangeError('مبلغ السند يجب أن يكون موجباً')
  if (counterAccountCode === treasury) throw new RangeError('الحساب المقابل لا يكون نفس الخزينة')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: amountMinor, credit: 0, note },
    { accountCode: counterAccountCode, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * سند صرف: نقدية خارجة —
 *   مدين: الحساب المقابل (مورد سداد دين، مصروف، مسحوبات…)، دائن: الخزينة/البنك
 */
export function buildPaymentVoucherEntry(
  treasury: TreasuryAccount,
  counterAccountCode: string,
  amountMinor: Minor,
  note: string,
): JournalLine[] {
  if (amountMinor <= 0) throw new RangeError('مبلغ السند يجب أن يكون موجباً')
  if (counterAccountCode === treasury) throw new RangeError('الحساب المقابل لا يكون نفس الخزينة')
  const lines: JournalLine[] = [
    { accountCode: counterAccountCode, debit: amountMinor, credit: 0, note },
    { accountCode: treasury, debit: 0, credit: amountMinor, note },
  ]
  assertBalanced(lines)
  return lines
}

/** تحويل بين الخزينة والبنك (إيداع/سحب) */
export function buildTransferEntry(
  fromTreasury: TreasuryAccount,
  toTreasury: TreasuryAccount,
  amountMinor: Minor,
  note: string,
  /** مصروف التحويل (رسوم بنكية/عمولة) — يخرج من المصدر إضافةً للمبلغ ويقيد 5108 (طلب المالك) */
  feeMinor: Minor = 0,
): JournalLine[] {
  if (fromTreasury === toTreasury) throw new RangeError('التحويل يكون بين خزينتين مختلفتين')
  if (amountMinor <= 0) throw new RangeError('مبلغ التحويل يجب أن يكون موجباً')
  if (!Number.isInteger(feeMinor) || feeMinor < 0) throw new RangeError('مصروف التحويل لا يكون سالباً')
  const lines: JournalLine[] = [
    { accountCode: toTreasury, debit: amountMinor, credit: 0, note },
  ]
  if (feeMinor > 0) lines.push({ accountCode: '5108', debit: feeMinor, credit: 0, note: 'مصروف تحويل (رسوم/عمولة)' })
  lines.push({ accountCode: fromTreasury, debit: 0, credit: amountMinor + feeMinor, note })
  assertBalanced(lines)
  return lines
}

/* ─── القيد اليدوي ─── */

/**
 * التحقق من قيد يدوي قبل الحفظ (زر الحفظ يظل معطلاً حتى تختفي الأخطاء):
 * حسابات ورقية موجودة، سطران فأكثر، توازن تام، لا سطر صفري أو مزدوج.
 */
export function validateManualEntry(
  lines: { accountCode: string; debit: Minor; credit: Minor }[],
  coa: Account[],
): string[] {
  const errors: string[] = []
  const meaningful = lines.filter((l) => l.debit !== 0 || l.credit !== 0)
  if (meaningful.length < 2) errors.push('القيد يحتاج طرفين على الأقل')
  for (const l of meaningful) {
    const acc = coa.find((a) => a.code === l.accountCode)
    if (!acc) { errors.push(`حساب غير معروف: ${l.accountCode || '(فارغ)'}`); continue }
    if (!acc.isPostable) errors.push(`«${acc.nameAr}» حساب تجميعي لا يقبل قيوداً مباشرة`)
    if (l.debit < 0 || l.credit < 0) errors.push('المبالغ السالبة مرفوضة — استخدم الطرف المقابل')
    if (l.debit > 0 && l.credit > 0) errors.push(`سطر «${acc.nameAr}» لا يكون مديناً ودائناً معاً`)
  }
  const d = meaningful.reduce((a, l) => a + l.debit, 0)
  const c = meaningful.reduce((a, l) => a + l.credit, 0)
  if (d !== c) errors.push(`غير متوازن: مدين ${d} ≠ دائن ${c}`)
  else if (d === 0 && meaningful.length >= 2) errors.push('قيد صفري مرفوض')
  return [...new Set(errors)]
}
