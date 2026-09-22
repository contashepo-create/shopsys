export interface DocumentCurrencySnapshot {
  currencyCode: string
  currencyDecimals: number
  /** عدد وحدات العملة المحلية الصغرى مقابل وحدة أجنبية كبرى × 10^rateScale. */
  localMinorPerForeignMajorScaled: number
  rateScale: number
  capturedAt: string
}

export function validateCurrencySnapshot(snapshot: DocumentCurrencySnapshot): string[] {
  const errors: string[] = []
  if (!/^[A-Z]{3}$/.test(snapshot.currencyCode)) errors.push('كود العملة غير صالح')
  if (!Number.isInteger(snapshot.currencyDecimals) || snapshot.currencyDecimals < 0 || snapshot.currencyDecimals > 4) errors.push('دقة العملة غير صالحة')
  if (!Number.isInteger(snapshot.rateScale) || snapshot.rateScale < 0 || snapshot.rateScale > 9) errors.push('دقة سعر الصرف غير صالحة')
  if (!Number.isInteger(snapshot.localMinorPerForeignMajorScaled) || snapshot.localMinorPerForeignMajorScaled <= 0) errors.push('سعر الصرف غير صالح')
  if (!/^\d{4}-\d{2}-\d{2}T/.test(snapshot.capturedAt)) errors.push('وقت تثبيت سعر الصرف غير صالح')
  return errors
}

/** التحويل بأعداد صحيحة وBigInt؛ لا float في القيود المالية. */
export function foreignMinorToLocalMinor(foreignMinor: number, snapshot: DocumentCurrencySnapshot): number {
  const errors = validateCurrencySnapshot(snapshot)
  if (errors.length) throw new RangeError(errors.join(' — '))
  if (!Number.isInteger(foreignMinor)) throw new RangeError('المبلغ الأجنبي يجب أن يكون بوحدات صغرى صحيحة')
  const denominator = BigInt(10 ** snapshot.currencyDecimals) * BigInt(10 ** snapshot.rateScale)
  const numerator = BigInt(foreignMinor) * BigInt(snapshot.localMinorPerForeignMajorScaled)
  const rounded = numerator >= 0n ? (numerator + denominator / 2n) / denominator : (numerator - denominator / 2n) / denominator
  const result = Number(rounded)
  if (!Number.isSafeInteger(result)) throw new RangeError('المبلغ المحول يتجاوز النطاق الآمن')
  return result
}
