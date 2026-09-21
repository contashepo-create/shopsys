/**
 * خدمات المحافظ والدفع الإلكتروني (طلب المالك — نمط mobileshop حرفياً):
 * تحويل رصيد / دفع فواتير / شحن / دفع إلكتروني / أخرى، بمزوّدين
 * (فودافون كاش، أورنج، اتصالات، إنستاباي، فوري…).
 *
 * النموذج المالي (المطابق لـmobileshop):
 * - «المدفوع للمزوّد» (paidToProvider) = ما يخرج فعلاً من أصل التمويل
 *   (المكينة/المحفظة/الخزينة التي خرج منها التحويل).
 * - «المحصَّل من العميل» (charge) = ما يدفعه العميل (أو يتبقى ديناً عليه).
 * - الربح مشتق آلياً ولا يُدخل يدوياً أبداً: الربح = المحصَّل − المدفوع للمزوّد.
 * - أصل الاستلام قد يختلف عن أصل التمويل (يستلم كاش بالدرج ويحوّل من
 *   محفظة إنستاباي) — لكلٍ خزينته المستقلة فلا يختل عدّ الأدراج.
 * - جزء آجل ⇒ دين على عميل مسجل (1104).
 * - الضريبة حسب بلد المنشأة: تُطبق على هامش الخدمة (العمولة) شاملةً —
 *   بلد بلا ضريبة ⇒ صفر تلقائياً؛ ويمكن تصفيرها لخدمات معفاة.
 *
 * القيد المتوازن:
 *   من ح/ خزينة الاستلام (المدفوع الآن) + 1104 العملاء (الباقي)
 *     إلى ح/ خزينة التمويل (المدفوع للمزوّد)
 *     إلى ح/ 4103 إيرادات خدمات (هامش الخدمة الصافي)
 *     إلى ح/ 2102 ض.ق.م (نصيب الهامش إن وجدت)
 * الربح السالب (تحويل بخسارة/مجاملة) يقلب سطر الإيراد لطرف مدين.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export const WALLET_SERVICE_TYPES = [
  { id: 'balance_transfer', nameAr: 'تحويل رصيد', icon: '💸' },
  { id: 'bill_payment', nameAr: 'دفع فواتير', icon: '🧾' },
  { id: 'topup', nameAr: 'شحن رصيد', icon: '📲' },
  { id: 'electronic_payment', nameAr: 'دفع إلكتروني', icon: '💳' },
  { id: 'other', nameAr: 'خدمة أخرى', icon: '🧩' },
] as const
export type WalletServiceType = (typeof WALLET_SERVICE_TYPES)[number]['id']

export const WALLET_PROVIDERS = [
  { id: 'vodafone', nameAr: 'فودافون كاش' },
  { id: 'orange', nameAr: 'أورنج كاش' },
  { id: 'etisalat', nameAr: 'اتصالات كاش' },
  { id: 'instapay', nameAr: 'إنستاباي' },
  { id: 'fawry', nameAr: 'فوري' },
  { id: 'stc_pay', nameAr: 'STC Pay' },
  { id: 'other', nameAr: 'مزوّد آخر' },
] as const
export type WalletProvider = (typeof WALLET_PROVIDERS)[number]['id']

export interface WalletServiceInput {
  type: WalletServiceType
  provider: WalletProvider
  targetPhone: string // رقم الوجهة/المرجع
  paidToProviderMinor: Minor // ما خرج من أصل التمويل
  chargeMinor: Minor // المحصَّل من العميل (إجمالي)
  paidMinor: Minor // المدفوع الآن (الباقي دين على عميل مسجل)
  customerId: number | null
  fundingTreasury: string // خزينة/محفظة التمويل (خرج منها التحويل)
  receiveTreasury: string // خزينة استلام مبلغ العميل (درج/مكينة)
  vatPercent: number // ضريبة بلد المنشأة على هامش الخدمة (شاملة) — 0 للمعفى
  notes: string
}

export interface WalletServiceTotals {
  profitGrossMinor: Minor // المحصَّل − المدفوع للمزوّد (قبل فصل الضريبة)
  vatMinor: Minor // نصيب الضريبة من الهامش (شاملة)
  revenueMinor: Minor // هامش الخدمة الصافي (بعد الضريبة)
  remainingMinor: Minor // الآجل على العميل
}

/** أخطاء التحقق — نصوص عربية جاهزة (مطابقة قواعد mobileshop) */
export function validateWalletService(i: WalletServiceInput): string[] {
  const errors: string[] = []
  if (!Number.isInteger(i.paidToProviderMinor) || i.paidToProviderMinor <= 0) errors.push('أدخل المبلغ المدفوع للمزوّد')
  if (!Number.isInteger(i.chargeMinor) || i.chargeMinor <= 0) errors.push('أدخل المبلغ المحصَّل من العميل')
  if (!Number.isInteger(i.paidMinor) || i.paidMinor < 0) errors.push('المدفوع لا يكون سالباً')
  if (i.paidMinor > i.chargeMinor) errors.push('المدفوع من العميل لا يتجاوز المحصَّل')
  if (i.paidMinor < i.chargeMinor && i.customerId == null) errors.push('الجزء الآجل يحتاج عميلاً مسجلاً — لا دين على عميل نقدي')
  if (!i.targetPhone.trim()) errors.push('رقم الوجهة/المرجع مطلوب')
  if (!i.fundingTreasury) errors.push('اختر أصل التمويل (المحفظة/المكينة التي خرج منها المبلغ)')
  if (i.paidMinor > 0 && !i.receiveTreasury) errors.push('اختر مكان استلام مبلغ العميل (درج أو مكينة)')
  if (i.vatPercent < 0 || i.vatPercent > 50) errors.push('نسبة ضريبة غير منطقية')
  return errors
}

/** الربح مشتق آلياً: المحصَّل − المدفوع للمزوّد؛ الضريبة تُفصل من الهامش (شاملة) */
export function computeWalletTotals(i: WalletServiceInput): WalletServiceTotals {
  const profitGross = i.chargeMinor - i.paidToProviderMinor
  // الضريبة على هامش موجب فقط — خسارة لا تولّد ضريبة
  const vat = profitGross > 0 && i.vatPercent > 0
    ? Math.round((profitGross * i.vatPercent) / (100 + i.vatPercent))
    : 0
  return {
    profitGrossMinor: profitGross,
    vatMinor: vat,
    revenueMinor: profitGross - vat,
    remainingMinor: i.chargeMinor - i.paidMinor,
  }
}

/** قيد العملية المتوازن — يدعم اختلاف خزينة الاستلام عن التمويل والربح السالب */
export function buildWalletServiceEntry(i: WalletServiceInput, t: WalletServiceTotals, label: string): JournalLine[] {
  const lines: JournalLine[] = []
  if (i.paidMinor > 0) lines.push({ accountCode: i.receiveTreasury, debit: i.paidMinor, credit: 0, note: `تحصيل ${label}` })
  if (t.remainingMinor > 0) lines.push({ accountCode: '1104', debit: t.remainingMinor, credit: 0, note: `آجل ${label}` })
  lines.push({ accountCode: i.fundingTreasury, debit: 0, credit: i.paidToProviderMinor, note: `تمويل ${label} من ${i.fundingTreasury}` })
  if (t.revenueMinor > 0) lines.push({ accountCode: '4103', debit: 0, credit: t.revenueMinor, note: 'هامش خدمة محافظ' })
  else if (t.revenueMinor < 0) lines.push({ accountCode: '4103', debit: -t.revenueMinor, credit: 0, note: 'خسارة خدمة محافظ (مجاملة/خطأ تسعير)' })
  if (t.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: t.vatMinor, note: 'ض.ق.م على هامش الخدمة' })
  assertBalanced(lines)
  return lines
}

/* ─── ملخص واجهة العرض ─── */

export interface WalletOpRow {
  chargeMinor: Minor
  paidToProviderMinor: Minor
  status: string
}

/** ملخص فترة: عدد العمليات + إجمالي المحصَّل + إجمالي الربح (يستثني المرتجع) */
export function walletSummary(ops: readonly WalletOpRow[]): { count: number; chargeMinor: Minor; profitMinor: Minor } {
  let charge = 0, profit = 0, count = 0
  for (const o of ops) {
    if (o.status === 'returned') continue
    count++
    charge += o.chargeMinor
    profit += o.chargeMinor - o.paidToProviderMinor
  }
  return { count, chargeMinor: charge, profitMinor: profit }
}
