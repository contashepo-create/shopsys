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

/** توزيع نسبي حتمي، والباقي على آخر سطر موجب ليطابق الرسم حرفياً. */
export function allocateChargeByLineBase(amountMinor: number, lineBasesMinor: number[]): ChargeAllocation[] {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new RangeError('قيمة الرسم غير صالحة')
  if (lineBasesMinor.some((base) => !Number.isInteger(base) || base < 0)) throw new RangeError('أساس توزيع السطر غير صالح')
  const total = lineBasesMinor.reduce((sum, base) => sum + base, 0)
  if (amountMinor > 0 && total === 0) throw new RangeError('لا يمكن توزيع رسم على أساس صفري')
  const positiveIndexes = lineBasesMinor.map((base, index) => base > 0 ? index : -1).filter((index) => index >= 0)
  let allocated = 0
  return lineBasesMinor.map((base, index) => {
    const lastPositive = index === positiveIndexes.at(-1)
    const value = base === 0 ? 0 : lastPositive ? amountMinor - allocated : Math.round(amountMinor * base / total)
    allocated += value
    return { lineIndex: index, amountMinor: value }
  })
}

export function documentNetAfterCharges(subtotalMinor: number, charges: DocumentCharge[]): number {
  const errors = validateDocumentCharges(charges)
  if (errors.length) throw new RangeError(errors.join(' — '))
  return charges.reduce((net, charge) => net + (charge.kind === 'discount' ? -charge.amountMinor : charge.amountMinor), subtotalMinor)
}
