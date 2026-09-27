export interface DocumentTaxSnapshot { code: string; nameAr: string; rateBasisPoints: number; registrationNumber?: string; capturedAt: string }
export interface TaxLineInput { netMinor: number; tax: DocumentTaxSnapshot | null }
export function validateTaxSnapshot(tax: DocumentTaxSnapshot): string[] {
  const errors: string[] = []
  if (!/^[A-Z0-9_-]{1,20}$/.test(tax.code)) errors.push('كود الضريبة غير صالح')
  if (!tax.nameAr.trim()) errors.push('اسم الضريبة مطلوب')
  if (!Number.isInteger(tax.rateBasisPoints) || tax.rateBasisPoints < 0 || tax.rateBasisPoints > 10000) errors.push('نسبة الضريبة غير صالحة')
  if (!Number.isFinite(Date.parse(tax.capturedAt))) errors.push('وقت لقطة الضريبة غير صالح')
  return errors
}
export function calculateTaxMinor(netMinor: number, tax: DocumentTaxSnapshot | null): number {
  if (!Number.isSafeInteger(netMinor) || netMinor < 0) throw new Error('صافي السطر الضريبي غير صالح')
  if (!tax) return 0
  const errors = validateTaxSnapshot(tax); if (errors.length) throw new Error(errors.join('، '))
  return Number((BigInt(netMinor) * BigInt(tax.rateBasisPoints) + 5000n) / 10000n)
}
export function summarizeTaxes(lines: TaxLineInput[]): Record<string, { netMinor: number; taxMinor: number }> {
  return lines.reduce<Record<string, { netMinor: number; taxMinor: number }>>((result, line) => { const key = line.tax?.code ?? 'EXEMPT'; const row = result[key] ?? { netMinor: 0, taxMinor: 0 }; row.netMinor += line.netMinor; row.taxMinor += calculateTaxMinor(line.netMinor, line.tax); result[key] = row; return result }, {})
}
