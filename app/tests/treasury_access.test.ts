import { describe, expect, it } from 'vitest'
import { allowedTreasuryCodes, effectiveDefaultTreasury, validateTreasuryAccess, validateTreasuryTransfer } from '../src/core/treasuryAccess.ts'

const access = {
  defaultTreasuryCode: '1101',
  grants: [
    { treasuryCode: '1101', operations: ['receipt', 'payment', 'refund', 'transfer_from'] as const, maxAmountMinor: 50_000 },
    { treasuryCode: '1102', operations: ['receipt', 'transfer_to'] as const },
  ],
}

describe('صلاحيات خزائن المستخدم', () => {
  it('يسمح بأكثر من خزينة حسب نوع العملية', () => {
    expect(allowedTreasuryCodes(access, 'receipt')).toEqual(['1101', '1102'])
    expect(allowedTreasuryCodes(access, 'payment')).toEqual(['1101'])
  })
  it('يفرض حد العملية', () => {
    expect(validateTreasuryAccess(access, '1101', 'payment', 40_000)).toEqual([])
    expect(validateTreasuryAccess(access, '1101', 'payment', 60_000)[0]).toContain('يتجاوز حد')
  })
  it('يفحص طرفي التحويل بصلاحيتين مستقلتين', () => {
    expect(validateTreasuryTransfer(access, '1101', '1102', 20_000)).toEqual([])
    expect(validateTreasuryTransfer(access, '1102', '1101', 20_000)).toHaveLength(2)
  })
  it('يختار الافتراضي المسموح ويصون توافق المستخدم القديم', () => {
    expect(effectiveDefaultTreasury(access, 'receipt', 'bank')).toBe('1101')
    expect(validateTreasuryAccess(undefined, 'bank', 'payment', 999)).toEqual([])
    expect(allowedTreasuryCodes(undefined, 'receipt')).toBeNull()
  })
})
