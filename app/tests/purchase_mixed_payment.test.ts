import { describe, expect, it } from 'vitest'
import { buildPurchaseEntryV2 } from '../src/core/purchases.ts'

describe('سداد فاتورة الشراء من عدة حسابات', () => {
  it('يوزع السداد على النقد والبنك والمحفظة ويبقي المتبقي للمورد', () => {
    const lines = buildPurchaseEntryV2({
      inventoryAccount: '1103', inventoryNote: 'مخزون', grandTotalMinor: 10_000,
      paidMinor: 7_000, payAccount: '1101', expensePayments: [],
      paymentCredits: [
        { account: '1101', amountMinor: 2_000, note: 'نقدي' },
        { account: '11021', amountMinor: 3_000, note: 'بنك' },
        { account: '11022', amountMinor: 2_000, note: 'محفظة' },
      ],
    })
    expect(lines.filter((line) => line.credit > 0).map((line) => [line.accountCode, line.credit])).toEqual([
      ['1101', 2_000], ['11021', 3_000], ['11022', 2_000], ['2101', 3_000],
    ])
    expect(lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0)
  })

  it('يسجل الشراء النقدي بلا مورد ولا ينشئ دائن 2101', () => {
    const lines = buildPurchaseEntryV2({
      inventoryAccount: '1103', inventoryNote: 'مخزون نقدي', grandTotalMinor: 5_000,
      paidMinor: 5_000, payAccount: '1101', expensePayments: [],
      paymentCredits: [{ account: '1101', amountMinor: 5_000, note: 'شراء نقدي' }], cashPurchase: true,
    })
    expect(lines.some((line) => line.accountCode === '2101')).toBe(false)
    expect(lines.find((line) => line.accountCode === '1101')?.credit).toBe(5_000)
  })

  it('يرفض شراءً نقدياً غير مسدد بالكامل', () => {
    expect(() => buildPurchaseEntryV2({
      inventoryAccount: '1103', inventoryNote: 'مخزون نقدي', grandTotalMinor: 5_000,
      paidMinor: 4_000, payAccount: '1101', expensePayments: [],
      paymentCredits: [{ account: '1101', amountMinor: 4_000, note: 'ناقص' }], cashPurchase: true,
    })).toThrow('الشراء النقدي يجب سداده بالكامل')
  })

  it('يرفض تجاوز إجمالي السداد لمستحق المورد', () => {
    expect(() => buildPurchaseEntryV2({
      inventoryAccount: '1103', inventoryNote: 'مخزون', grandTotalMinor: 5_000,
      paidMinor: 6_000, payAccount: '1101', expensePayments: [],
      paymentCredits: [{ account: '1101', amountMinor: 6_000, note: 'زائد' }],
    })).toThrow('المدفوع أكبر من مستحق المورد')
  })
})
