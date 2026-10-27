/**
 * ربط الشيكات الواردة بذمم المستخلصات (بلاغ المالك 2026-10-27).
 * ─────────────────────────────────────────────────────────────
 * المشكلة: كشف حساب العميل (`customerStatement`) يُضيف كل شيك وارد سطراً
 * دائناً يخفض رصيده، بينما دفتر التوزيع الذي تبني منه تقارير المشاريع
 * «المحصّل/المتبقي/الذمم المفتوحة» (`getOpenClientInvoices`) كان يقرأ
 * `clientSettlements` و`vouchers` فقط — فلا يرى الشيك إطلاقاً. فيظهر الشيك
 * في الكشف ولا يظهر خصمه في تقرير المشروع.
 *
 * الحل: مصدر واحد للحقيقة. تُحوَّل الشيكات الواردة النشطة إلى «توزيعات
 * تحصيل» FIFO على المستندات المفتوحة، وتُضاف إلى خريطة `settled` داخل
 * `getOpenClientInvoices`، فتتطابق كل التقارير مع الكشف.
 *
 * قواعد محاسبية (مطابقة لقيود `core/cheques.ts` و`customerStatement`):
 *  · الاستلام: 1106 أوراق قبض ← 1104 العملاء ⇒ الدين ينتقل من العميل للورقة.
 *  · التحصيل: بنك/خزينة ← 1106 ⇒ لا يمسّ حساب العميل (لا خصم ثانٍ).
 *  · الارتداد: 1104 ← 1106 ⇒ يعود الدين؛ يُلغى أثر الورقة (**تُستثنى**).
 *  · الملغاة/بلا طرف/الصادرة: لا تُحتسب تحصيلاً على عميل.
 * نواة خالصة بلا واجهات — قابلة للفحص بالبوابات والاختبارات.
 */
import type { Minor } from './money.ts'

/** الحد الأدنى من بيانات الشيك المطلوب لحساب الذمم (متوافق مع core/cheques.Cheque) */
export interface ChequeDuesLike {
  direction: 'incoming' | 'outgoing'
  partyId: number | null
  status: string
  amountMinor: Minor
  /** تاريخ الاستلام — لترتيب FIFO عند توزيع أكثر من شيك */
  createdAt?: string
}

/** مستند مفتوح بحدّه الأدنى للتوزيع (متوافق مع OpenInvoice) */
export interface OpenDocForDues {
  docKey: string
  docLabel: string
  dueMinor: Minor
  settledMinor: Minor
  date: string
}

/** هل الورقة شيك وارد **نشط** (ما زال يُطفئ دين العميل)؟ */
export function chequeSettlesCustomerDues(c: ChequeDuesLike): boolean {
  if (c.direction !== 'incoming' || c.partyId == null) return false
  // `bounced` يعيد الدين بسطر مدين في الكشف؛ `cancelled` لم يُستلم أصلاً.
  if (c.status === 'bounced' || c.status === 'cancelled') return false
  return Number.isInteger(c.amountMinor) && c.amountMinor > 0
}

/** إجمالي الشيكات الواردة النشطة لعميل بعينه — يُخصم من ذممه */
export function activeIncomingChequesTotal(cheques: readonly ChequeDuesLike[], customerId: number): Minor {
  let total = 0
  for (const c of cheques) {
    if (c.partyId !== customerId || !chequeSettlesCustomerDues(c)) continue
    total += c.amountMinor
  }
  return total
}

/**
 * توزيع مبلغ الشيكات على المستندات المفتوحة بنمط FIFO (الأقدم أولاً)،
 * تماماً كتوزيع سند القبض — لئلا يختلف ترتيب الإطفاء بين الكشف والتقرير.
 * الفائض (شيكات أكبر من الذمم) يبقى غير موزَّع: لا رصيد سالب للمستند.
 */
export function allocateChequeDues(
  cheques: readonly ChequeDuesLike[],
  customerId: number,
  openInvoices: readonly OpenDocForDues[],
): { allocations: { docKey: string; docLabel: string; appliedMinor: Minor }[]; unallocatedMinor: Minor } {
  let rest = activeIncomingChequesTotal(cheques, customerId)
  const open = openInvoices
    .map((inv) => ({ ...inv, remaining: Math.max(0, inv.dueMinor - inv.settledMinor) }))
    .filter((inv) => inv.remaining > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.docKey.localeCompare(b.docKey))
  const allocations: { docKey: string; docLabel: string; appliedMinor: Minor }[] = []
  for (const inv of open) {
    if (rest <= 0) break
    const take = Math.min(rest, inv.remaining)
    allocations.push({ docKey: inv.docKey, docLabel: inv.docLabel, appliedMinor: take })
    rest -= take
  }
  return { allocations, unallocatedMinor: rest }
}
