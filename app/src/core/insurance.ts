/**
 * جهات التعاقد والتأمين الطبي — سد فجوة أنظمة الصيدليات والمعامل
 * ================================================================
 * الجهة (شركة تأمين/شركة تعاقد) تتحمل نسبة من الفاتورة:
 *   المريض يدفع نصيبه نقداً (co-pay)، ونصيب الجهة يقيد ذمة على 1110
 *   (مطالبة claim)، ثم تُسوى مطالبات الجهة دفعة واحدة عند التحصيل.
 *
 * القيود:
 *   بيع/طلب بتغطية: خزينة (نصيب المريض) + 1110 (نصيب الجهة) مدين /
 *                    إيراد + ضريبة دائن (+ قيد تكلفة للبضاعة كالمعتاد)
 *   تحصيل من الجهة:  خزينة مدين / 1110 دائن
 */
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'
import type { Minor } from './money.ts'
import type { StockBatch } from './batches.ts'

export interface InsuranceProvider {
  id: number
  nameAr: string
  /** نسبة تحمل الجهة ٪ من إجمالي الفاتورة */
  coveragePercent: number
  phone: string
  notes: string
  isActive: boolean
}

export function validateProvider(nameAr: string, coveragePercent: number, existing: InsuranceProvider[], editingId?: number): string[] {
  const errors: string[] = []
  if (!nameAr.trim()) errors.push('اسم الجهة مطلوب')
  if (existing.some((p) => p.nameAr === nameAr.trim() && p.id !== editingId)) errors.push('يوجد جهة بهذا الاسم')
  if (!(coveragePercent > 0) || coveragePercent > 100) errors.push('نسبة التحمل بين 1 و100')
  return errors
}

/** تقسيم الفاتورة: نصيب الجهة يُقرَّب لأسفل والباقي على المريض (المريض لا يظلم بكسور) */
export function splitCoverage(totalMinor: Minor, coveragePercent: number): { providerShareMinor: Minor; patientShareMinor: Minor } {
  if (totalMinor <= 0) throw new Error('الإجمالي يجب أن يكون موجباً')
  const provider = Math.floor((totalMinor * coveragePercent) / 100)
  return { providerShareMinor: provider, patientShareMinor: totalMinor - provider }
}

/** أساس محفوظ عند بيع صنف واحد بوحدات صحيحة، لا يُستنتج للفواتير القديمة. */
export interface InsuredPartialBasis {
  itemId: number
  qty: number
  warehouseId: number | null
  revenueMinor: Minor
  taxMinor: Minor
  providerMinor: Minor
  costMinor: Minor
}

/** توزيع تراكمي موثق: المبلغ أولاً، ثم الضريبة والتغطية؛ يستهلك الباقي عند آخر وحدة. */
export function insuredPartialAmounts(basis: InsuredPartialBasis, previousQty: number, qty: number) {
  const { itemId, revenueMinor, taxMinor, providerMinor, costMinor } = basis
  const total = revenueMinor + taxMinor
  if (![itemId, basis.qty, revenueMinor, taxMinor, providerMinor, costMinor, total, previousQty, qty].every(Number.isSafeInteger) || (basis.warehouseId !== null && (!Number.isSafeInteger(basis.warehouseId) || basis.warehouseId <= 0)) || itemId <= 0 || basis.qty <= 0 || revenueMinor < 0 || taxMinor < 0 || providerMinor < 0 || providerMinor > total || costMinor < 0 || total <= 0 || previousQty < 0 || qty <= 0 || previousQty + qty > basis.qty) throw new Error('كمية أو أساس المرتجع الجزئي غير صالح')
  const cumulative = (count: number) => {
    const rounded = (value: number) => Number((BigInt(value) * BigInt(count) * 2n + BigInt(basis.qty)) / (BigInt(basis.qty) * 2n))
    const gross = rounded(total)
    const share = (value: number) => Number(BigInt(gross) * BigInt(value) / BigInt(total))
    const tax = share(taxMinor), provider = share(providerMinor)
    return { total: gross, revenue: gross - tax, tax, provider, patient: gross - provider, cost: rounded(costMinor) }
  }
  const a = cumulative(previousQty), b = cumulative(previousQty + qty)
  return { total: b.total - a.total, revenue: b.revenue - a.revenue, tax: b.tax - a.tax, provider: b.provider - a.provider, patient: b.patient - a.patient, cost: b.cost - a.cost }
}

/** مطالبة على جهة — تتجمع حتى التحصيل */
export interface InsuranceClaim {
  id: number
  providerId: number
  /** مصدر المطالبة */
  source: 'sale' | 'lab_order' | 'clinic_visit'
  sourceId: number
  date: string
  totalMinor: Minor // إجمالي الفاتورة
  claimMinor: Minor // نصيب الجهة (يتناقص مع مرتجعات G9)
  settled: boolean
  settlementEntryId: number | null
  /** G9: ما عُكس من المطالبة بمرتجعات (تخفيض 1110) — undefined = سجل قديم */
  reversedMinor?: Minor
  /** جزء الجهة الذي نشأ التزاماً بعد تحصيل المطالبة، لا يعد ردّاً نقدياً. */
  settledRefundMinor?: Minor
  refundPayments?: { journalEntryId: number; amountMinor: Minor; treasury: string; date: string; reason: string }[]
  /** رد كامل بيع مخزني محصّل، بحركة المريض والمخزون المؤكدة. */
  saleRefund?: { journalEntryId: number; treasury: string; reason: string; date: string }
  /** أصل وحدوي محدد للبيع الجديد وسجل مرتجعاته؛ لا يتوفر للسجلات القديمة. */
  salePartialBasis?: InsuredPartialBasis
  salePartialRefunds?: { qty: number; journalEntryId: number; treasury: string; reason: string; date: string }[]
  /** G10: سطور البيع المؤمَّن بالوحدة الأساسية وقيمتها — لاسترجاع المخزون عند عكس القيد */
  saleLines?: { itemId: number; qty: number; valueMinor: Minor }[]
  /** الوحدات المختارة فعلياً ولقطة دفعة كل وحدة إن تتبعت الصلاحية. */
  saleSerials?: { itemId: number; serial: string; batch: StockBatch | null }[]
  /** لقطة الكمية المصروفة من دفعات الصلاحية — لازمة لإرجاع نفس تواريخها عند إلغاء البيع. */
  expiryBatches?: StockBatch[]
}

/**
 * قيد بيع بتغطية تأمينية (يشمل التكلفة للبضاعة):
 * خزينة بنصيب المريض + 1110 بنصيب الجهة / 4101|4106 + 2102 (+5101/1103 للبضاعة)
 */
export function buildInsuredEntry(args: {
  patientShareMinor: Minor
  providerShareMinor: Minor
  revenueMinor: Minor
  revenueAccount: '4101' | '4106' | '4108'
  vatMinor: Minor
  cogsMinor: Minor
  treasury: string
  providerName: string
}): JournalLine[] {
  const lines: JournalLine[] = []
  if (args.patientShareMinor > 0) lines.push({ accountCode: args.treasury, debit: args.patientShareMinor, credit: 0, note: 'نصيب المريض نقداً' })
  if (args.providerShareMinor > 0) lines.push({ accountCode: '1110', debit: args.providerShareMinor, credit: 0, note: `مطالبة ${args.providerName}` })
  lines.push({ accountCode: args.revenueAccount, debit: 0, credit: args.revenueMinor, note: 'الإيراد' })
  if (args.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: args.vatMinor, note: 'ض.ق.م' })
  if (args.cogsMinor > 0) {
    lines.push({ accountCode: '5101', debit: args.cogsMinor, credit: 0, note: 'تكلفة البضاعة' })
    lines.push({ accountCode: '1103', debit: 0, credit: args.cogsMinor, note: 'خروج مخزون' })
  }
  assertBalanced(lines)
  return lines
}

/** قيد تحصيل مطالبات جهة مجمعة: خزينة / 1110 */
export function buildClaimSettlementEntry(totalMinor: Minor, providerName: string, treasury = '1101'): JournalLine[] {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) throw new Error('لا مطالبات غير محصلة لهذه الجهة')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: totalMinor, credit: 0, note: `تحصيل من ${providerName}` },
    { accountCode: '1110', debit: 0, credit: totalMinor, note: 'إطفاء مطالبات' },
  ]
  assertBalanced(lines)
  return lines
}
