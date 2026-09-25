export type TaxPriceMode = 'exclusive' | 'inclusive'
export interface TaxPriceBreakdown { netMinor: number; taxMinor: number; grossMinor: number }
export function splitTaxPrice(amountMinor: number, rateBasisPoints: number, mode: TaxPriceMode): TaxPriceBreakdown {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error('قيمة السعر الضريبي غير صالحة')
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) throw new Error('نسبة السعر الضريبي غير صالحة')
  if (mode === 'exclusive') {
    const taxMinor = Number((BigInt(amountMinor) * BigInt(rateBasisPoints) + 5000n) / 10000n)
    return { netMinor: amountMinor, taxMinor, grossMinor: amountMinor + taxMinor }
  }
  const netMinor = Number((BigInt(amountMinor) * 10000n + BigInt(10000 + rateBasisPoints) / 2n) / BigInt(10000 + rateBasisPoints))
  return { netMinor, taxMinor: amountMinor - netMinor, grossMinor: amountMinor }
}
