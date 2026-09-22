export type TreasuryOperation = 'view_balance' | 'receipt' | 'payment' | 'refund' | 'transfer_from' | 'transfer_to'

export interface UserTreasuryGrant {
  treasuryCode: string
  operations: TreasuryOperation[]
  /** صفر/غياب = بلا حد خاص؛ المبالغ بوحدات minor. */
  maxAmountMinor?: number | null
}

export interface UserTreasuryAccess {
  grants?: UserTreasuryGrant[]
  defaultTreasuryCode?: string | null
}

export function allowedTreasuryCodes(access: UserTreasuryAccess | null | undefined, operation: TreasuryOperation): string[] | null {
  if (!access?.grants) return null // مستخدم قديم: توافق خلفي حتى يضبطه المدير
  return access.grants.filter((grant) => grant.operations.includes(operation)).map((grant) => grant.treasuryCode)
}

export function validateTreasuryAccess(
  access: UserTreasuryAccess | null | undefined,
  treasuryCode: string,
  operation: TreasuryOperation,
  amountMinor = 0,
): string[] {
  if (!access?.grants) return []
  const grant = access.grants.find((candidate) => candidate.treasuryCode === treasuryCode)
  if (!grant || !grant.operations.includes(operation)) return [`غير مسموح للمستخدم بتنفيذ العملية على الخزينة/البنك ${treasuryCode}`]
  if (grant.maxAmountMinor != null && grant.maxAmountMinor > 0 && amountMinor > grant.maxAmountMinor) {
    return [`المبلغ يتجاوز حد المستخدم على الخزينة/البنك ${treasuryCode}`]
  }
  return []
}

export function validateTreasuryTransfer(
  access: UserTreasuryAccess | null | undefined,
  fromCode: string,
  toCode: string,
  amountMinor: number,
): string[] {
  if (fromCode === toCode) return ['التحويل يكون بين حسابين نقديين مختلفين']
  return [
    ...validateTreasuryAccess(access, fromCode, 'transfer_from', amountMinor),
    ...validateTreasuryAccess(access, toCode, 'transfer_to', amountMinor),
  ]
}

export function effectiveDefaultTreasury(
  access: UserTreasuryAccess | null | undefined,
  operation: TreasuryOperation,
  fallbackCode: string,
): string {
  const allowed = allowedTreasuryCodes(access, operation)
  if (allowed == null) return access?.defaultTreasuryCode || fallbackCode
  if (access?.defaultTreasuryCode && allowed.includes(access.defaultTreasuryCode)) return access.defaultTreasuryCode
  return allowed[0] ?? fallbackCode
}
