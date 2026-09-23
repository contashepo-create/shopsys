export type InvoiceCommissionBasis = 'fixed' | 'gross' | 'net' | 'profit'

export function calculateInvoiceCommissionMinor(input: {
  basis: InvoiceCommissionBasis
  value: number
  grossMinor: number
  netMinor: number
  profitMinor: number
}): number {
  if (!Number.isFinite(input.value) || input.value < 0) throw new Error('قيمة العمولة غير صالحة')
  if (input.basis === 'fixed') return Math.round(input.value)
  const base = input.basis === 'gross' ? input.grossMinor : input.basis === 'net' ? input.netMinor : Math.max(0, input.profitMinor)
  return Math.max(0, Math.round(base * input.value / 100))
}
