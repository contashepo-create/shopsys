export type DocumentChargeKind = 'discount' | 'shipping' | 'insurance' | 'customs' | 'service' | 'other'
export interface DocumentCharge { kind: DocumentChargeKind; nameAr: string; amountMinor: number; taxable: boolean }
export interface ChargeAllocation { lineIndex: number; amountMinor: number }

export function validateDocumentCharges(charges: DocumentCharge[]): string[] {
  const errors: string[] = []
  for (const charge of charges) {
    if (!charge.nameAr.trim()) errors.push('اسم الخصم/الرسم مطلوب')
    if (!Number.isInteger(charge.amountMinor) || charge.amountMinor < 0) errors.push(`قيمة «${charge.nameAr || 'رسم'}» غير صالحة`)
  }
  return errors
}

/**
 * توزيع نسبي حتمي، والباقي على آخر سطر موجب ليطابق الرسم حرفياً.
 *
 * (إصلاح §76) كان غير-الأخير يُقرَّب نصفاً لأعلى (Math.round) فإذا تجاوز مجموع
 * التقريبات الرسمَ أخذ آخر سطر موجب الفرق **سالباً**: (2, [1,1,1,1]) ⇒ [1,1,1,−1].
 * الآن floor بـ BigInt (بلا فقد دقة float فوق 2^53) والباقي على الأخير —
 * Σfloor ≤ الرسم دائماً فلا حصة سالبة، والمجموع مطابق حرفياً.
 */
export function allocateChargeByLineBase(amountMinor: number, lineBasesMinor: number[]): ChargeAllocation[] {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new RangeError('قيمة الرسم غير صالحة')
  if (lineBasesMinor.some((base) => !Number.isInteger(base) || base < 0)) throw new RangeError('أساس توزيع السطر غير صالح')
  const total = lineBasesMinor.reduce((sum, base) => sum + base, 0)
  if (amountMinor > 0 && total === 0) throw new RangeError('لا يمكن توزيع رسم على أساس صفري')
  const positiveIndexes = lineBasesMinor.map((base, index) => base > 0 ? index : -1).filter((index) => index >= 0)
  const totalBig = BigInt(total)
  let allocated = 0
  return lineBasesMinor.map((base, index) => {
    const lastPositive = index === positiveIndexes.at(-1)
    const value = base === 0 ? 0 : lastPositive ? amountMinor - allocated : Number(BigInt(amountMinor) * BigInt(base) / totalBig)
    allocated += value
    return { lineIndex: index, amountMinor: value }
  })
}

export function documentNetAfterCharges(subtotalMinor: number, charges: DocumentCharge[]): number {
  const errors = validateDocumentCharges(charges)
  if (errors.length) throw new RangeError(errors.join(' — '))
  const net = charges.reduce((net, charge) => net + (charge.kind === 'discount' ? -charge.amountMinor : charge.amountMinor), subtotalMinor)
  // إصلاح §84: الخصم الذي يلتهم الصافي كان يعيد صافياً سالباً بصمت — بينما
  // calculateDocumentTotals تحرس القاعدة نفسها («الخصم يتجاوز قيمة المستند»).
  // توحيد القاعدة في النواة كلها: لا صافٍ سالب لمستند تجاري.
  if (net < 0) throw new RangeError('الخصم يتجاوز قيمة المستند')
  return net
}
