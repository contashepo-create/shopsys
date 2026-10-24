import { describe, expect, it } from 'vitest'
import { buildProjectExpenseLedger, projectExpenseLedgerExportRows } from '../src/core/projectExpenseLedger.ts'

describe('كشف مصروفات المشروع والتصدير', () => {
  it('يصدر المدفوع والآجل مرة واحدة للمستند متعدد البنود كي تبقى مجاميع Excel صحيحة', () => {
    const ledger = buildProjectExpenseLedger([{
      id: 12,
      date: '2026-10-23',
      kind: 'materials',
      description: 'شراء مواد',
      amountMinor: 3000,
      vatMinor: 0,
      grossMinor: 3000,
      payment: 'mixed',
      paidMinor: 1000,
      dueMinor: 2000,
      journalEntryId: 44,
      lines: [
        { description: 'أسمنت', kind: 'materials', qty: 1, unitPriceMinor: 1000, taxMode: 'none', vatPercent: 0, netMinor: 1000, vatMinor: 0, grossMinor: 1000 },
        { description: 'حديد', kind: 'materials', qty: 1, unitPriceMinor: 2000, taxMode: 'none', vatPercent: 0, netMinor: 2000, vatMinor: 0, grossMinor: 2000 },
      ],
    }], {
      supplierName: () => 'المورد',
      treasuryName: () => 'الخزينة',
      custodyLabel: () => 'عهدة',
      boqLabel: () => '',
      journalEntryNumber: () => 44,
    })

    const rows = projectExpenseLedgerExportRows(ledger.rows, 2)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row[15])).toEqual([10, 0])
    expect(rows.map((row) => row[16])).toEqual([20, 0])
    expect((rows[0][15] as number) + (rows[1][15] as number)).toBe(10)
    expect((rows[0][16] as number) + (rows[1][16] as number)).toBe(20)
  })
})
