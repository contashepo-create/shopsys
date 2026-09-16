/**
 * وحدة المغاسل (طلب المالك: «أين وحدة المعالجة والإدارة الخاصة بالمغاسل؟») —
 * ليست «صيانة وتذاكر»: أمر غسيل بقطع مفصلة (قميص/بدلة/سجادة…) وخدمة لكل قطعة
 * (غسيل/كي/غسيل وكي/دراي كلين)، بحالات: مستلَم ← جاري التجهيز ← جاهز ← مُسلَّم.
 *
 * المحاسبة (مبدأ الاستحقاق الصحيح):
 *   العربون عند الاستلام:  مدين خزينة ← دائن 2109 دفعات مقدمة من العملاء (التزام — ليس إيراداً بعد)
 *   عند التسليم (تحقق الإيراد): مدين خزينة (المتبقي) + مدين 2109 (تصفية العربون)
 *                              ← دائن 4103 إيراد خدمات + 2102 ضريبة
 *   الإلغاء قبل التسليم:   رد العربون: مدين 2109 ← دائن الخزينة
 * نواة خالصة — كل الأموال أعداد صحيحة (Minor).
 */
import type { Minor } from './money.ts'
import { splitInclusiveTax, addExclusiveTax } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

/* ─── الخدمات ─── */

export type LaundryService = 'wash' | 'iron' | 'wash_iron' | 'dry_clean' | 'carpet' | 'other'

export const LAUNDRY_SERVICE_LABELS: Record<LaundryService, { nameAr: string; icon: string }> = {
  wash: { nameAr: 'غسيل', icon: '💧' },
  iron: { nameAr: 'كي', icon: '🔥' },
  wash_iron: { nameAr: 'غسيل وكي', icon: '✨' },
  dry_clean: { nameAr: 'دراي كلين', icon: '🧥' },
  carpet: { nameAr: 'سجاد وموكيت', icon: '🧶' },
  other: { nameAr: 'خدمة أخرى', icon: '🧺' },
}

/* ─── الحالات ─── */

export type LaundryStatus = 'received' | 'processing' | 'ready' | 'delivered' | 'cancelled'

export const LAUNDRY_STATUS_LABELS: Record<LaundryStatus, string> = {
  received: 'مستلَم',
  processing: 'جاري التجهيز',
  ready: 'جاهز للتسليم',
  delivered: 'مُسلَّم ✓',
  cancelled: 'ملغي',
}

/** الانتقالات المسموحة — التسليم والإلغاء نهائيان */
export const LAUNDRY_TRANSITIONS: Record<LaundryStatus, LaundryStatus[]> = {
  received: ['processing', 'ready', 'cancelled'],
  processing: ['ready', 'cancelled'],
  ready: ['processing', 'delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export function assertLaundryTransition(from: LaundryStatus, to: LaundryStatus): void {
  if (!LAUNDRY_TRANSITIONS[from].includes(to)) {
    throw new Error(`لا يمكن نقل الأمر من «${LAUNDRY_STATUS_LABELS[from]}» إلى «${LAUNDRY_STATUS_LABELS[to]}»`)
  }
}

/* ─── بنود الأمر ─── */

export interface LaundryLine {
  desc: string // قميص، بدلة، سجادة 2×3…
  service: LaundryService
  qty: number
  unitPriceMinor: Minor
}

export function validateLaundryOrder(args: { lines: LaundryLine[]; prepaidMinor: Minor }): string[] {
  const errors: string[] = []
  const lines = args.lines.filter((l) => l.desc.trim() || l.qty > 0)
  if (lines.length === 0) errors.push('أضف قطعة واحدة على الأقل')
  for (const l of lines) {
    if (!l.desc.trim()) errors.push('كل قطعة تحتاج وصفاً (قميص، بدلة…)')
    if (!Number.isInteger(l.qty) || l.qty <= 0) errors.push(`كمية «${l.desc || '؟'}» يجب أن تكون عدداً موجباً`)
    if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) errors.push(`سعر «${l.desc || '؟'}» غير صالح`)
  }
  if (!Number.isInteger(args.prepaidMinor) || args.prepaidMinor < 0) errors.push('العربون لا يكون سالباً')
  const total = laundryTotal(lines)
  if (args.prepaidMinor > total) errors.push('العربون أكبر من إجمالي الأمر')
  return [...new Set(errors)]
}

export function laundryTotal(lines: LaundryLine[]): Minor {
  return lines.reduce((a, l) => a + l.unitPriceMinor * l.qty, 0)
}

/* ─── القيود ─── */

/** عربون الاستلام: خزينة ← 2109 دفعات مقدمة (التزام — الإيراد لم يتحقق بعد) */
export function buildLaundryPrepaidEntry(amountMinor: Minor, note: string, treasury = '1101'): JournalLine[] {
  if (amountMinor <= 0) throw new Error('مبلغ العربون يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: amountMinor, credit: 0, note },
    { accountCode: '2109', debit: 0, credit: amountMinor, note: 'عربون أمر غسيل' },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * قيد التسليم (تحقق الإيراد):
 *   مدين: الخزينة بالمتبقي المحصَّل + 2109 بالعربون المصفّى
 *   دائن: 4103 إيراد خدمات (الأساس) + 2102 الضريبة
 */
export function buildLaundryDeliverEntry(args: {
  totalMinor: Minor
  prepaidMinor: Minor
  taxPercent: number
  taxInclusive: boolean
  note: string
  treasury?: string
}): { lines: JournalLine[]; taxMinor: Minor; baseMinor: Minor; grandMinor: Minor } {
  const t = args.treasury ?? '1101'
  let base: Minor, tax: Minor, grand: Minor
  if (args.taxPercent <= 0) {
    base = args.totalMinor; tax = 0; grand = args.totalMinor
  } else if (args.taxInclusive) {
    ;[base, tax] = splitInclusiveTax(args.totalMinor, args.taxPercent)
    grand = args.totalMinor
  } else {
    base = args.totalMinor
    ;[tax, grand] = addExclusiveTax(args.totalMinor, args.taxPercent)
  }
  const remaining = grand - args.prepaidMinor
  if (remaining < 0) throw new Error('العربون أكبر من إجمالي الأمر بعد الضريبة')
  const lines: JournalLine[] = []
  if (remaining > 0) lines.push({ accountCode: t, debit: remaining, credit: 0, note: 'تحصيل عند التسليم' })
  if (args.prepaidMinor > 0) lines.push({ accountCode: '2109', debit: args.prepaidMinor, credit: 0, note: 'تصفية العربون' })
  lines.push({ accountCode: '4103', debit: 0, credit: base, note: args.note })
  if (tax > 0) lines.push({ accountCode: '2102', debit: 0, credit: tax, note: 'ض.ق.م' })
  assertBalanced(lines)
  return { lines, taxMinor: tax, baseMinor: base, grandMinor: grand }
}

/**
 * G3 (مراجعة المرتجعات): استرداد خدمة بعد التسليم — «مرتجع خدمة» (Service Credit Note).
 * عميل غير راضٍ عن الغسيل بعد استلامه: الخدمة لا تعود للمخزون (لا بضاعة)،
 * فالقيد عكس الإيراد وحصة الضريبة فقط — بنفس معاملة الضريبة المسجلة وقت التسليم:
 *   مدين 4102 مرتجعات المبيعات (الأساس) + مدين 2102 (حصة الضريبة النسبية)
 *   دائن الخزينة (رد نقدي) و/أو 1104 (خصم من حساب العميل)
 * refundValueMinor = المبلغ الإجمالي المردود (شامل الضريبة) بسقف grandMinor المتبقي.
 */
export function buildServiceRefundEntry(args: {
  refundValueMinor: Minor // المردود الإجمالي (شامل حصته الضريبية)
  deliveredGrandMinor: Minor // إجمالي الأمر المُسلَّم شامل الضريبة
  deliveredTaxMinor: Minor // الضريبة المسجلة وقت التسليم
  priorRefundedMinor: Minor // مردود سابق على نفس الأمر (تراكمي)
  priorRefundedTaxMinor: Minor // ضريبة عُكست سابقاً
  mode: 'cash' | 'customer_credit'
  treasury?: string
  note: string
}): { lines: JournalLine[]; taxShareMinor: Minor; baseMinor: Minor } {
  const { refundValueMinor: v, deliveredGrandMinor: grand, deliveredTaxMinor: tax } = args
  if (!Number.isInteger(v) || v <= 0) throw new Error('قيمة الاسترداد يجب أن تكون موجبة')
  const remaining = grand - args.priorRefundedMinor
  if (v > remaining) throw new Error(`قيمة الاسترداد تتجاوز المتبقي القابل للرد (${remaining})`)
  // حصة الضريبة النسبية بسقف ما لم يُعكس بعد (نفس منطق N2 في مرتجع الشراء)
  const taxShare = tax > 0 ? Math.min(Math.round((tax * v) / grand), tax - args.priorRefundedTaxMinor) : 0
  const base = v - taxShare
  const lines: JournalLine[] = [
    { accountCode: '4102', debit: base, credit: 0, note: args.note },
  ]
  if (taxShare > 0) lines.push({ accountCode: '2102', debit: taxShare, credit: 0, note: 'تخفيض ض.ق.م' })
  if (args.mode === 'cash') lines.push({ accountCode: args.treasury ?? '1101', debit: 0, credit: v, note: 'رد نقدية' })
  else lines.push({ accountCode: '1104', debit: 0, credit: v, note: 'إيداع في حساب العميل' })
  assertBalanced(lines)
  return { lines, taxShareMinor: taxShare, baseMinor: base }
}

/** إلغاء أمر عليه عربون: رد العربون — 2109 ← الخزينة */
export function buildLaundryCancelEntry(prepaidMinor: Minor, note: string, treasury = '1101'): JournalLine[] {
  if (prepaidMinor <= 0) throw new Error('لا عربون لرده')
  const lines: JournalLine[] = [
    { accountCode: '2109', debit: prepaidMinor, credit: 0, note },
    { accountCode: treasury, debit: 0, credit: prepaidMinor, note: 'رد عربون' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── تقرير ─── */

export interface LaundryReportRow {
  service: LaundryService
  pieces: number
  revenueMinor: Minor
}

export function laundryReport(
  orders: { status: LaundryStatus; lines: LaundryLine[] }[],
): { rows: LaundryReportRow[]; totalPieces: number; totalRevenueMinor: Minor; openOrders: number } {
  const map = new Map<LaundryService, { pieces: number; rev: Minor }>()
  let open = 0
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    if (o.status !== 'delivered') { open++; continue }
    for (const l of o.lines) {
      const cur = map.get(l.service) ?? { pieces: 0, rev: 0 }
      cur.pieces += l.qty
      cur.rev += l.unitPriceMinor * l.qty
      map.set(l.service, cur)
    }
  }
  const rows = [...map.entries()].map(([service, v]) => ({ service, pieces: v.pieces, revenueMinor: v.rev }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
  return {
    rows,
    totalPieces: rows.reduce((a, r) => a + r.pieces, 0),
    totalRevenueMinor: rows.reduce((a, r) => a + r.revenueMinor, 0),
    openOrders: open,
  }
}
