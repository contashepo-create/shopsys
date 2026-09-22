import { describe, expect, it } from 'vitest'
import { summarizeTreasuryByUser } from '../src/core/treasuryUserReport.ts'

const journal = [
  { id: 1, date: '2026-09-20', createdBy: 'أحمد', sourceType: 'sale', lines: [{ accountCode: '1101', debit: 1000, credit: 0 }] },
  { id: 2, date: '2026-09-21', createdBy: 'أحمد', sourceType: 'payment_voucher', lines: [{ accountCode: '1101', debit: 0, credit: 300 }] },
  { id: 3, date: '2026-09-21', createdBy: 'منى', sourceType: 'sale', lines: [{ accountCode: '1102', debit: 500, credit: 0 }] },
  { id: 4, date: '2026-09-22', createdBy: null, sourceType: 'sale', lines: [{ accountCode: '1101', debit: 20, credit: 0 }] },
]

describe('تقرير حركة الخزائن حسب المستخدم', () => {
  it('يجمع القبض والصرف والصافي وعدد العمليات', () => {
    expect(summarizeTreasuryByUser(journal, ['1101'])[0]).toEqual({ userName: 'أحمد', receiptsMinor: 1000, paymentsMinor: 300, netMinor: 700, operationsCount: 2 })
  })
  it('يعزل الخزائن ويحتفظ بسجل قديم غير محدد', () => {
    const rows = summarizeTreasuryByUser(journal, ['1102', '1101'])
    expect(rows.find((row) => row.userName === 'منى')?.receiptsMinor).toBe(500)
    expect(rows.find((row) => row.userName.includes('سجل قديم'))?.receiptsMinor).toBe(20)
  })
  it('يدعم نطاق التاريخ', () => {
    const rows = summarizeTreasuryByUser(journal, ['1101'], '2026-09-21', '2026-09-21')
    expect(rows).toEqual([{ userName: 'أحمد', receiptsMinor: 0, paymentsMinor: 300, netMinor: -300, operationsCount: 1 }])
  })
})
