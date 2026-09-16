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
export function splitRefund(
  refundValueMinor: number,
  refund: PaymentMethod,
  openCreditMinor: number,
  receivedMinor: number,
): { cashMinor: number; creditMinor: number } {
  if (!Number.isInteger(refundValueMinor) || refundValueMinor <= 0) throw new RangeError('قيمة المرتجع يجب أن تكون موجبة')
  const openCredit = Math.max(0, openCreditMinor)
  const received = Math.max(0, receivedMinor)
  if (refund === 'credit') {
    const credit = Math.min(refundValueMinor, openCredit)
    return { creditMinor: credit, cashMinor: refundValueMinor - credit }
  }
  const cash = Math.min(refundValueMinor, received)
  return { cashMinor: cash, creditMinor: refundValueMinor - cash }
}

/** النقدية الخارجة فعلاً من مرتجع (للورديات/الطباعة) — التوافق الخلفي: سجلات قديمة بلا تقسيم */
export function returnCashRefundMinor(r: { refund: PaymentMethod; totals: { totalMinor: number }; cashRefundMinor?: number }): number {
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
  refund: PaymentMethod,
  treasury = '1101',
  split?: { cashMinor: number; creditMinor: number },
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
  if (totals.cogsMinor > 0) {
    lines.push({ accountCode: '1103', debit: totals.cogsMinor, credit: 0, note: 'عودة بضاعة للمخزون' })
    lines.push({ accountCode: '5101', debit: 0, credit: totals.cogsMinor, note: 'تخفيض تكلفة مبيعات' })
  }
  assertBalanced(lines)
  return lines
}
