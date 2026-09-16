/**
 * مرتجع الخدمة الموحّد (Service Credit Note) — مراجعة المرتجعات على مستوى كل الأنشطة
 * ─────────────────────────────────────────────────────────────────────────────
 * الخدمات لا تعود للمخزون: القيد يعكس الإيراد وحصته الضريبية فقط.
 * نواة واحدة تخدم: المغسلة (4103)، الصيانة (4103)، تأجير المعدات (4104)،
 * النقلات (4105)، المعمل (4106)، مستخلصات المقاولات (4107)، العيادة (4108).
 *
 * القيد (نمط Credit Note في QuickBooks/Zoho/Odoo):
 *   مدين 4102 مرتجعات المبيعات (الأساس) — بند contra-revenue موحّد في قائمة الدخل
 *   مدين 2102 ض.ق.م (الحصة النسبية بسقف غير المعكوس — نفس منطق N2)
 *   دائن الخزينة (رد نقدي) أو حساب الذمم (خصم/إيداع في حساب العميل)
 *
 * تراكمي بسقف إجمالي المستند: refunds متتالية على نفس المستند لا تتجاوز قيمته،
 * وكسور الضريبة لا تضيع (السقف يضمن أن مجموع الحصص = ضريبة المستند بالضبط).
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

/** سجل استرداد واحد على مستند خدمة — يُخزن على المستند نفسه (تتبع تراكمي) */
export interface ServiceRefundRecord {
  date: string
  amountMinor: Minor // الإجمالي المردود (شامل حصته الضريبية)
  taxShareMinor: Minor
  mode: 'cash' | 'customer_credit'
  reason: string
  journalEntryId: number
}

export function buildServiceRefundEntry(args: {
  refundValueMinor: Minor // المردود الإجمالي (شامل حصته الضريبية)
  deliveredGrandMinor: Minor // إجمالي المستند شامل الضريبة (وعاء الاسترداد)
  deliveredTaxMinor: Minor // الضريبة المسجلة على المستند
  priorRefundedMinor: Minor // مردود سابق على نفس المستند (تراكمي)
  priorRefundedTaxMinor: Minor // ضريبة عُكست سابقاً
  mode: 'cash' | 'customer_credit'
  /** حساب الذمم الدائن في نمط customer_credit — 1104 عملاء افتراضاً */
  creditAccount?: string
  treasury?: string
  note: string
}): { lines: JournalLine[]; taxShareMinor: Minor; baseMinor: Minor } {
  const { refundValueMinor: v, deliveredGrandMinor: grand, deliveredTaxMinor: tax } = args
  if (!Number.isInteger(v) || v <= 0) throw new Error('قيمة الاسترداد يجب أن تكون موجبة')
  if (!Number.isInteger(grand) || grand <= 0) throw new Error('إجمالي المستند غير صالح')
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
  else lines.push({ accountCode: args.creditAccount ?? '1104', debit: 0, credit: v, note: 'خصم/إيداع في حساب العميل' })
  assertBalanced(lines)
  return { lines, taxShareMinor: taxShare, baseMinor: base }
}
