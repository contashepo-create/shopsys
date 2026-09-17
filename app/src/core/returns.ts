/**
 * مرتجعات المبيعات — ShopSys (بداية المرحلة 3)
 * ─────────────────────────────────────────────
 * المرتجع دائماً مربوط بفاتورة أصلية: يُسترد بنفس أسعار وخصومات
 * البيع الأصلي، ولا يمكن إرجاع كمية أكثر مما بيع (تراكمياً عبر
 * كل المرتجعات السابقة على نفس الفاتورة).
 * القيد العاكس: دائن خزينة/عملاء، مدين مرتجعات مبيعات + ض.ق.م،
 * والبضاعة تعود للمخزون بتكلفتها (مدين مخزون / دائن تكلفة مبيعات).
 */
import type { CartLine, CartTotals, PaymentMethod } from './pos.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

/** الكميات المتبقية القابلة للإرجاع لكل صنف (الأصل − مجموع المرتجعات السابقة) */
export function remainingReturnable(
  saleLines: CartLine[],
  priorReturnLines: CartLine[],
): Map<number, number> {
  const map = new Map<number, number>()
  for (const l of saleLines) map.set(l.itemId, (map.get(l.itemId) ?? 0) + l.qty)
  for (const r of priorReturnLines) {
    map.set(r.itemId, Math.round(((map.get(r.itemId) ?? 0) - r.qty) * 1000) / 1000)
  }
  return map
}

/**
 * بناء سطور المرتجع من الفاتورة الأصلية بكميات مطلوبة لكل صنف.
 * تُستهلك الكميات من سطور الأصل بالترتيب محافظةً على سعر وخصم كل سطر.
 * يرمي خطأ لو طُلبت كمية أكبر من المتبقي القابل للإرجاع.
 */
export function buildReturnLines(
  saleLines: CartLine[],
  priorReturnLines: CartLine[],
  qtyByItem: Map<number, number>,
): CartLine[] {
  const remaining = remainingReturnable(saleLines, priorReturnLines)
  const out: CartLine[] = []
  for (const [itemId, wanted] of qtyByItem) {
    if (wanted <= 0) continue
    const canReturn = remaining.get(itemId) ?? 0
    if (wanted > canReturn + 1e-9) {
      const name = saleLines.find((l) => l.itemId === itemId)?.nameAr ?? `#${itemId}`
      throw new RangeError(`«${name}»: المطلوب إرجاع ${wanted} والمتبقي القابل للإرجاع ${canReturn}`)
    }
    let left = wanted
    for (const l of saleLines) {
      if (l.itemId !== itemId || left <= 0) continue
      const take = Math.min(left, l.qty)
      out.push({ ...l, qty: Math.round(take * 1000) / 1000 })
      left = Math.round((left - take) * 1000) / 1000
    }
  }
  if (!out.length) throw new RangeError('لا كميات للإرجاع')
  return out
}

/**
 * استنتاج إعدادات الضريبة من إجماليات الفاتورة الأصلية —
 * فيُحسب المرتجع بنفس المعاملة الضريبية وقت البيع حتى لو تغيرت الإعدادات لاحقاً.
 */
export function deriveTaxConfig(totals: CartTotals): { taxPercent: number; taxInclusive: boolean } {
  if (totals.taxMinor <= 0 || totals.taxBaseMinor <= 0) return { taxPercent: 0, taxInclusive: true }
  const taxPercent = Math.round((totals.taxMinor / totals.taxBaseMinor) * 10000) / 100
  return { taxPercent, taxInclusive: totals.totalMinor === totals.netMinor }
}

/**
 * تقسيم الرد الهجين لفاتورة الدفع المجزأ (إصلاح R1):
 * قيمة المرتجع تُوزَّع بين تخفيض ذمم العميل (1104) ورد النقدية —
 * فلا نرد نقداً أكثر مما استلمناه فعلاً، ولا نخفض ديناً أكثر من المتبقي المفتوح.
 *
 * - refund='credit': الأولوية لتخفيض الدين المفتوح، والفائض (جزء دفعه العميل) يُرد نقداً.
 * - refund='cash': الأولوية للرد النقدي بسقف المُحصَّل فعلاً، والباقي يخفض الدين.
 * الفاتورة النقدية الكاملة أو الآجلة الكاملة حالتان خاصتان تعطيان السلوك القديم نفسه.
 *
 * openCreditMinor = المتبقي الآجل المفتوح على الفاتورة (الجزء الآجل − مرتجعات آجلة سابقة − تحصيلات مخصصة لها)
 * receivedMinor  = المُحصَّل فعلاً القابل للرد نقداً (المدفوع وقت البيع + التحصيلات المخصصة − ردود نقدية سابقة)
 */
/**
 * G2: «إيداع في حساب العميل» (Store Credit — نمط QuickBooks/Zoho «Retain as credit»):
 * كامل قيمة المرتجع تُقيَّد دائنة على 1104 بلا سقف المفتوح — لو تجاوزت دينه
 * انقلب رصيده دائناً (له عندنا) ويُخصم من فواتيره القادمة. لا نقدية تخرج إطلاقاً.
 */
export type RefundMode = PaymentMethod | 'store_credit'

/* ─── ترقية المرتجع للنمط العالمي (Shopify POS / Lightspeed / ERPNext) ─── */

/**
 * حالة البضاعة المرتجعة — تحدد المسار المحاسبي لجانب التكلفة:
 * - resellable: تعود للمخزون القابل للبيع (مدين 1103 / دائن 5101)
 * - damaged: تالفة لا تصلح للبيع — تُعاد التكلفة من COGS إلى الهالك
 *   (مدين 5111 / دائن 5101) ولا يلمس رصيد المخزون إطلاقاً.
 *   فالعميل استرد ماله، والخسارة تظهر في بند الهالك لا في تكلفة المبيعات.
 */
export type ReturnCondition = 'resellable' | 'damaged'

/** أكواد أسباب الإرجاع الموحدة (نمط POS العالمي — تقارير «لماذا يرجعون؟») */
export const RETURN_REASONS: { id: string; nameAr: string; defaultCondition: ReturnCondition }[] = [
  { id: 'defective', nameAr: 'عيب مصنعي / تالف', defaultCondition: 'damaged' },
  { id: 'wrong_item', nameAr: 'صنف خاطئ / غير مطابق للطلب', defaultCondition: 'resellable' },
  { id: 'changed_mind', nameAr: 'العميل غيّر رأيه', defaultCondition: 'resellable' },
  { id: 'expired', nameAr: 'منتهي الصلاحية', defaultCondition: 'damaged' },
  { id: 'wrong_size', nameAr: 'مقاس/لون غير مناسب', defaultCondition: 'resellable' },
  { id: 'late_delivery', nameAr: 'تأخر التسليم', defaultCondition: 'resellable' },
  { id: 'price_dispute', nameAr: 'خلاف على السعر', defaultCondition: 'resellable' },
  { id: 'other', nameAr: 'سبب آخر…', defaultCondition: 'resellable' },
]

export function returnReasonName(id: string): string {
  return RETURN_REASONS.find((r) => r.id === id)?.nameAr ?? id
}

/** سطر مرتجع مطوّر: يذكر سطر الفاتورة الأصلي الذي استُهلك منه + حالة البضاعة */
export type ReturnLine = CartLine & {
  /** فهرس السطر في فاتورة البيع الأصلية — undefined = سجل قديم (قبل الترقية) */
  saleLineIndex?: number
  /** حالة البضاعة — undefined = سجل قديم (عوملت resellable) */
  condition?: ReturnCondition
}

/** طلب إرجاع سطر محدد بعينه من الفاتورة (النمط العالمي — لا تجميع بالصنف) */
export interface ReturnLineSpec {
  lineIndex: number
  qty: number
  condition: ReturnCondition
}

/**
 * المتبقي القابل للإرجاع لكل «سطر» من الفاتورة (لا لكل صنف):
 * المرتجعات القديمة بلا saleLineIndex تُستهلك من سطور نفس الصنف بالترتيب
 * (نفس خوارزمية buildReturnLines القديمة — فلا انحراف عن السجلات القائمة).
 */
export function remainingByLine(saleLines: CartLine[], priorReturnLines: ReturnLine[]): number[] {
  const rem = saleLines.map((l) => l.qty)
  for (const r of priorReturnLines) {
    if (r.saleLineIndex !== undefined && saleLines[r.saleLineIndex]?.itemId === r.itemId) {
      rem[r.saleLineIndex] = Math.round((rem[r.saleLineIndex] - r.qty) * 1000) / 1000
      continue
    }
    // سجل قديم: استهلاك من سطور نفس الصنف بالترتيب
    let left = r.qty
    for (let i = 0; i < saleLines.length && left > 1e-9; i++) {
      if (saleLines[i].itemId !== r.itemId || rem[i] <= 0) continue
      const take = Math.min(left, rem[i])
      rem[i] = Math.round((rem[i] - take) * 1000) / 1000
      left = Math.round((left - take) * 1000) / 1000
    }
  }
  return rem
}

/**
 * بناء سطور المرتجع من مواصفات «سطر بسطر» (المرحلة 2 من معالج المرتجع):
 * كل سطر يحمل سعره وخصمه الأصليين + حالته (سليم/تالف) + مرجع سطره الأصلي.
 * يرمي خطأ عند تجاوز المتبقي القابل للإرجاع لذلك السطر تحديداً.
 */
export function buildReturnLinesPerLine(
  saleLines: CartLine[],
  priorReturnLines: ReturnLine[],
  specs: ReturnLineSpec[],
): ReturnLine[] {
  const rem = remainingByLine(saleLines, priorReturnLines)
  const out: ReturnLine[] = []
  const seen = new Set<number>()
  for (const spec of specs) {
    if (spec.qty <= 0) continue
    const src = saleLines[spec.lineIndex]
    if (!src) throw new RangeError(`سطر غير موجود في الفاتورة (#${spec.lineIndex + 1})`)
    if (seen.has(spec.lineIndex)) throw new RangeError(`السطر «${src.nameAr}» مكرر في طلب الإرجاع`)
    seen.add(spec.lineIndex)
    const can = rem[spec.lineIndex]
    if (spec.qty > can + 1e-9) {
      throw new RangeError(`«${src.nameAr}» (سطر ${spec.lineIndex + 1}): المطلوب إرجاع ${spec.qty} والمتبقي القابل للإرجاع ${can}`)
    }
    out.push({ ...src, qty: Math.round(spec.qty * 1000) / 1000, saleLineIndex: spec.lineIndex, condition: spec.condition })
  }
  if (!out.length) throw new RangeError('لا كميات للإرجاع')
  return out
}

/** تكلفة الجزء التالف من سطور مرتجع (لقيد الهالك 5111 وتخطي عودة المخزون) */
export function damagedCostOf(lines: ReturnLine[]): number {
  return lines
    .filter((l) => l.condition === 'damaged')
    .reduce((a, l) => a + Math.round(l.qty * l.unitCostMinor), 0)
}

export function splitRefund(
  refundValueMinor: number,
  refund: RefundMode,
  openCreditMinor: number,
  receivedMinor: number,
): { cashMinor: number; creditMinor: number } {
  if (!Number.isInteger(refundValueMinor) || refundValueMinor <= 0) throw new RangeError('قيمة المرتجع يجب أن تكون موجبة')
  const openCredit = Math.max(0, openCreditMinor)
  const received = Math.max(0, receivedMinor)
  if (refund === 'store_credit') {
    // كل القيمة رصيداً للعميل — لا نقدية تخرج ولا سقف (الرصيد الدائن مقصود)
    return { creditMinor: refundValueMinor, cashMinor: 0 }
  }
  if (refund === 'credit') {
    const credit = Math.min(refundValueMinor, openCredit)
    return { creditMinor: credit, cashMinor: refundValueMinor - credit }
  }
  const cash = Math.min(refundValueMinor, received)
  return { cashMinor: cash, creditMinor: refundValueMinor - cash }
}

/** النقدية الخارجة فعلاً من مرتجع (للورديات/الطباعة) — التوافق الخلفي: سجلات قديمة بلا تقسيم */
export function returnCashRefundMinor(r: { refund: RefundMode; totals: { totalMinor: number }; cashRefundMinor?: number }): number {
  return r.cashRefundMinor ?? (r.refund === 'cash' ? r.totals.totalMinor : 0)
}

/**
 * القيد العاكس للمرتجع (القرار 9):
 *   مدين: مرتجعات المبيعات (4102) بالأساس الضريبي
 *   مدين: ض.ق.م المستحقة (2102) — تخفيض الالتزام
 *   دائن: الخزينة (1101) و/أو العملاء (1104) بالمبلغ المسترد (رد هجين للدفع المجزأ)
 *   مدين: المخزون (1103) / دائن: تكلفة المبيعات (5101) — عودة البضاعة بتكلفتها
 */
export function buildReturnEntry(
  totals: CartTotals,
  refund: RefundMode,
  treasury = '1101',
  split?: { cashMinor: number; creditMinor: number },
  /**
   * تكلفة الجزء التالف من البضاعة المرتجعة (حالة damaged):
   * لا يعود للمخزون — مدين «هالك وتوالف 5111» بدلاً من «مخزون 1103».
   * كلا الجزأين يخفضان تكلفة المبيعات 5101 (البيع انعكس بالكامل).
   */
  damagedCostMinor = 0,
): JournalLine[] {
  // بلا تقسيم صريح: السلوك القديم — كل القيمة على طرف واحد حسب نوع الرد
  const cashMinor = split ? split.cashMinor : refund === 'cash' ? totals.totalMinor : 0
  const creditMinor = split ? split.creditMinor : refund === 'cash' ? 0 : totals.totalMinor
  if (cashMinor < 0 || creditMinor < 0) throw new RangeError('تقسيم الرد لا يحتمل قيماً سالبة')
  if (cashMinor + creditMinor !== totals.totalMinor) throw new RangeError('تقسيم الرد لا يساوي قيمة المرتجع')
  const lines: JournalLine[] = [
    { accountCode: '4102', debit: totals.taxBaseMinor, credit: 0, note: 'مرتجعات مبيعات' },
  ]
  // الرد النقدي يخرج من الخزينة التي استلمت البيع أصلاً (توحيد مصدر النقدية)
  if (cashMinor > 0) lines.push({ accountCode: treasury, debit: 0, credit: cashMinor, note: 'رد نقدية' })
  if (creditMinor > 0) lines.push({ accountCode: '1104', debit: 0, credit: creditMinor, note: 'تخفيض ذمم عملاء' })
  if (totals.taxMinor > 0) {
    lines.push({ accountCode: '2102', debit: totals.taxMinor, credit: 0, note: 'تخفيض ض.ق.م' })
  }
  if (!Number.isInteger(damagedCostMinor) || damagedCostMinor < 0) throw new RangeError('تكلفة التالف لا تكون سالبة')
  if (damagedCostMinor > totals.cogsMinor) throw new RangeError('تكلفة التالف تتجاوز تكلفة المرتجع')
  if (totals.cogsMinor > 0) {
    const backToStock = totals.cogsMinor - damagedCostMinor
    if (backToStock > 0) lines.push({ accountCode: '1103', debit: backToStock, credit: 0, note: 'عودة بضاعة للمخزون' })
    // التالف: خسارة محققة في بند الهالك — لا يدخل المخزون ولا يبقى في COGS
    if (damagedCostMinor > 0) lines.push({ accountCode: '5111', debit: damagedCostMinor, credit: 0, note: 'مرتجع تالف — هالك وتوالف' })
    lines.push({ accountCode: '5101', debit: 0, credit: totals.cogsMinor, note: 'تخفيض تكلفة مبيعات' })
  }
  assertBalanced(lines)
  return lines
}
