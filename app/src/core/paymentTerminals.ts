export type PaymentTerminalStatus = 'active' | 'suspended' | 'retired'
export interface PaymentTerminal {
  id: string
  code: string
  nameAr: string
  providerName: string
  branchId: string
  settlementAccountCode: string
  terminalId: string
  merchantId?: string
  serialNumber?: string
  status: PaymentTerminalStatus
}
export function validatePaymentTerminal(terminal: PaymentTerminal, terminals: PaymentTerminal[] = [], requireBranch = false): string[] {
  const errors: string[] = []
  if (!terminal.id.trim()) errors.push('معرف ماكينة الدفع مطلوب')
  if (!/^[A-Z0-9-]{2,20}$/.test(terminal.code)) errors.push('كود ماكينة الدفع غير صالح')
  if (!terminal.nameAr.trim() || !terminal.providerName.trim()) errors.push('اسم الماكينة ومزود الدفع مطلوبان')
  // الفرع اختياري في وضع الفرع الواحد، ويصبح مطلوباً عندما توجد فروع فعلية.
  if (requireBranch && !terminal.branchId.trim()) errors.push('فرع ماكينة الدفع مطلوب')
  if (!terminal.settlementAccountCode.trim()) errors.push('حساب تسوية ماكينة الدفع مطلوب')
  if (!terminal.terminalId.trim()) errors.push('رقم الطرفية مطلوب')
  if (terminals.some((row) => row.id !== terminal.id && row.code === terminal.code)) errors.push('كود ماكينة الدفع مستخدم')
  if (terminals.some((row) => row.id !== terminal.id && row.providerName === terminal.providerName && row.terminalId === terminal.terminalId)) errors.push('رقم الطرفية مكرر لدى مزود الدفع')
  return errors
}
export function nextTerminalCode(existingCodes: string[]): string {
  const max = existingCodes.map((code) => /^TERM-(\d+)$/.exec(code)?.[1]).filter((value): value is string => !!value).reduce((value, raw) => Math.max(value, Number(raw)), 0)
  return `TERM-${String(max + 1).padStart(4, '0')}`
}
