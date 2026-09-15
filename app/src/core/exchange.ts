/**
 * الاستبدال (جولة مراجعة نشاط الملابس):
 * أشهر عملية في محل الملابس: العميل يرجع قطعة (مقاس/لون لا يناسبه) ويأخذ
 * غيرها في نفس اللحظة — عمليتان محاسبيتان (مرتجع + بيع) بمستند واحد EXC-####
 * وصافي واحد يظهر للكاشير:
 *   الصافي = إجمالي الجديد − قيمة المرتجع
 *   موجب  ⇒ العميل يدفع الفرق، سالب ⇒ نرد له الفرق، صفر ⇒ تبادل متكافئ.
 * لا قيد مختصر «يبلع» العمليتين: قيد المرتجع الكامل + قيد البيع الكامل يبقيان
 * (4102 ترصد المرتجعات و4101 المبيعات بلا تشويه) — المستند يربطهما فقط.
 */
import type { Minor } from './money.ts'

export interface ExchangeReturnLine {
  itemId: number
  qty: number
}

export interface ExchangeNewLine {
  itemId: number
  qty: number
  /** تركيبة لون/مقاس إن كان الصنف موزعاً على تشكيلة */
  variantColor?: string
  variantSize?: string
}

export interface ExchangePreview {
  returnValueMinor: Minor // ما يعود للعميل عن المرتجع (بأسعار الفاتورة الأصلية)
  newValueMinor: Minor // قيمة القطع الجديدة
  netMinor: Minor // موجب = يدفع العميل، سالب = نرد له
}

export function computeExchangeNet(returnValueMinor: Minor, newValueMinor: Minor): ExchangePreview {
  return { returnValueMinor, newValueMinor, netMinor: newValueMinor - returnValueMinor }
}

export function validateExchange(args: {
  returnLines: ExchangeReturnLine[]
  newLines: ExchangeNewLine[]
}): string[] {
  const errors: string[] = []
  if (args.returnLines.length === 0) errors.push('حدد القطع المرتجعة — الاستبدال يبدأ بإرجاع')
  if (args.newLines.length === 0) errors.push('حدد القطع الجديدة — وإلا فهو مرتجع عادي (من شاشة المرتجعات)')
  for (const l of args.returnLines) if (l.qty <= 0) errors.push('كمية مرتجعة غير صالحة')
  for (const l of args.newLines) if (l.qty <= 0) errors.push('كمية جديدة غير صالحة')
  return errors
}
