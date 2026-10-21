import { describe, expect, it } from 'vitest'
import { buildReturnLines } from '../src/core/returns.ts'
import { computeTotals } from '../src/core/pos.ts'
import { cashFlowReport, toCsv, vatReport } from '../src/core/financialReports.ts'
import { hashPin, verifyPin, isModernPinHash } from '../src/core/audit.ts'
import { lanPatchBetween, lanSnapshotOf } from '../src/data/lan/protocol.ts'
import { reconcileStockValue, withdrawStockValue, weightedAverage } from '../src/core/costing.ts'
import { inventoryValue } from '../src/core/reports.ts'
import { compareBranches } from '../src/core/branches.ts'

const cartLine = (discountPercent: number) => ({
  itemId: 7, nameAr: 'منتج', qty: 1, unitPriceMinor: 10_000, unitCostMinor: 0,
  discountPercent, soldByWeight: false,
})
const journalEntry = (id: number, sourceType: any, lines: any[], reversesEntryId: number | null = null) => ({
  id, entryNumber: id, date: '2026-01-10', description: 'test', sourceType, sourceId: null,
  lines, createdBy: 'test', createdAt: '2026-01-10', reversedByEntryId: null, reversesEntryId,
})
const jline = (accountCode: string, debit: number, credit: number) => ({ accountCode, debit, credit, note: '' })

describe('regressions from the audit review', () => {
  it('legacy quantity-based returns consume only each line remaining quantity', () => {
    const sale = [cartLine(0), cartLine(50)]
    const first = buildReturnLines(sale, [], new Map([[7, 1]]))
    const second = buildReturnLines(sale, first, new Map([[7, 1]]))
    expect(first.map((l) => l.saleLineIndex)).toEqual([0])
    expect(second.map((l) => l.saleLineIndex)).toEqual([1])
    expect(second[0].discountPercent).toBe(50)
  })

  it('classifies reversal VAT using the original economic source', () => {
    const entries = [
      journalEntry(1, 'sale', [jline('1001', 11_400, 0), jline('4001', 0, 10_000), jline('2102', 0, 1_400)]),
      journalEntry(2, 'purchase', [jline('1501', 5_000, 0), jline('2102', 500, 0), jline('2001', 0, 5_500)]),
      journalEntry(3, 'reversal', [jline('1501', 0, 5_000), jline('2102', 0, 500), jline('2001', 5_500, 0)], 2),
      journalEntry(4, 'payment_voucher', [jline('2102', 1_400, 0), jline('1001', 0, 1_400)]),
      journalEntry(5, 'reversal', [jline('2102', 0, 1_400), jline('1001', 1_400, 0)], 4),
    ]
    expect(vatReport(entries as any, { from: '2026-01-01', to: '2026-12-31' })).toMatchObject({
      outputVatMinor: 1_400, inputVatMinor: 0, netDueMinor: 1_400, settledMinor: 0, remainingMinor: 1_400,
    })
  })

  it('does not expose PIN-like fields in LAN snapshots or patches', () => {
    const state = { appUsers: [{ nameAr: 'كاشير', pinHash: 'hash', initialPin: '123456' }], ownerTempPin: { pinHash: 'hash' }, ordinary: 3 }
    expect(JSON.stringify(lanSnapshotOf(state))).not.toMatch(/pinHash|initialPin|ownerTempPin|123456/)
    expect(JSON.stringify(lanPatchBetween({}, state, Object.keys(state)))).not.toMatch(/pinHash|initialPin|ownerTempPin/)
  })

  it('uses salted slow PIN hashes and verifies them', async () => {
    const one = await hashPin('123456')
    const two = await hashPin('123456')
    expect(isModernPinHash(one)).toBe(true)
    expect(one).not.toBe(two)
    expect(await verifyPin('123456', one)).toBe(true)
    expect(await verifyPin('123457', one)).toBe(false)
  })

  it('allocates exact stock value across partial withdrawals and clears the final remainder', () => {
    expect(weightedAverage(0, 0, 3, 1_000)).toBe(333)
    // A receipt first covers negative stock at the previous moving-average cost.
    expect(weightedAverage(-1, 100, 2, 400, -100)).toBe(300)
    // Purchase averaging must consume the carried exact value, not 3 × rounded 333.
    expect(weightedAverage(1, 0, 1, 0, 1)).toBe(1)
    const first = withdrawStockValue(3, 1_000, 1)
    const second = withdrawStockValue(first.remainingQty, first.remainingValueMinor, 1)
    const final = withdrawStockValue(second.remainingQty, second.remainingValueMinor, 1)
    expect([first.withdrawnValueMinor, second.withdrawnValueMinor, final.withdrawnValueMinor]).toEqual([333, 334, 333])
    expect(first.withdrawnValueMinor + second.withdrawnValueMinor + final.withdrawnValueMinor).toBe(1_000)
    expect(final.remainingQty).toBe(0)
    expect(final.remainingValueMinor).toBe(0)
    const subMinorAverage = withdrawStockValue(6, 1, 3)
    const subMinorFinal = withdrawStockValue(subMinorAverage.remainingQty, subMinorAverage.remainingValueMinor, 3)
    expect([subMinorAverage.withdrawnValueMinor, subMinorFinal.withdrawnValueMinor]).toEqual([0, 1])
    const afterSale = reconcileStockValue(3, 333, 1_000, 2, 333)
    expect(afterSale).toEqual({ stockValueMinor: 667, costMinor: 334 })
    const afterNextSale = reconcileStockValue(2, 334, afterSale.stockValueMinor, 1, 334)
    expect(afterNextSale.stockValueMinor).toBe(333)
    expect(reconcileStockValue(0, 100, 0, -1, 100)).toEqual({ stockValueMinor: 0, costMinor: 100 })
    expect(reconcileStockValue(-1, 100, -100, 1, 100)).toEqual({ stockValueMinor: 100, costMinor: 100 })
    expect(() => withdrawStockValue(1, 100, 2)).toThrow(/تتجاوز الرصيد/)
    expect(inventoryValue([{ id: 1, nameAr: 'دقيق', stockQty: 3, costMinor: 333, stockValueMinor: 1_000 }]).totalMinor).toBe(1_000)
  })

  it('allocates exact inventory value between branches without losing a minor unit', () => {
    const branches = [
      { id: 1, nameAr: 'أ', isMain: true, active: true, warehouseId: 11, treasuryCode: '1101' },
      { id: 2, nameAr: 'ب', isMain: false, active: true, warehouseId: 22, treasuryCode: '1102' },
    ] as any
    const rows = compareBranches({
      branches, sales: [], saleReturns: [], saleWarehouseById: new Map(), accountBalances: new Map(),
      warehouseStock: new Map([[11, new Map([[7, 1]])], [22, new Map([[7, 1]])]]),
      itemCostById: new Map([[7, 500]]), itemValueById: new Map([[7, 1_001]]), itemQtyById: new Map([[7, 2]]),
    })
    expect(rows.reduce((sum, row) => sum + row.stockValueMinor, 0)).toBe(1_001)
  })

  it('rounds COGS once for duplicate fractional lines of the same item and cost basis', () => {
    const totals = computeTotals([
      { ...cartLine(0), qty: 0.5, unitCostMinor: 1 },
      { ...cartLine(0), qty: 0.5, unitCostMinor: 1 },
    ], 0, 0, true)
    expect(totals.cogsMinor).toBe(1)
  })

  it('labels a cash sale inflow by revenue rather than its larger COGS line', () => {
    const entry = journalEntry(1, 'sale', [
      jline('1101', 1_000_000, 0), jline('4001', 0, 1_000_000),
      jline('5101', 910_000, 0), jline('1103', 0, 910_000),
    ])
    const report = cashFlowReport([entry as any], ['1101'], { from: '2026-01-01', to: '2026-12-31' })
    expect(report.inflows[0].label).not.toBe('تكلفة البضاعة المباعة')
    expect(report.inflows[0].amountMinor).toBe(1_000_000)
  })

  it('neutralizes spreadsheet formulas in financial CSV strings, preserving negative numbers', () => {
    const csv = toCsv(['description', 'amount'], [['=1+1', -250], [' \t=CMD()', -1.5]])
    expect(csv).toContain("'=1+1")
    expect(csv).toContain("' \t=CMD()")
    expect(csv).toContain(',-250')
    expect(csv).toContain(',-1.5')
  })
})
