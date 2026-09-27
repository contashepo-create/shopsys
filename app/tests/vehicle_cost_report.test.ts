import { describe, expect, it } from 'vitest'
import { buildVehicleReport, vehicleReportCategories } from '../src/core/vehicleReports.ts'

const vehicle = { id: 1, plateNumber: '1', vehicleType: 'تريلا', defaultDriverId: null, notes: '' }
const trip = (date: string, revenueMinor: number) => ({ id: 1, tripNumber: 'TR-1', date, customerId: null, vehicleId: 1, driverId: null, fromLoc: '', toLoc: '', qty: 1, unitPriceMinor: revenueMinor, payment: 'cash' as const, vatPercent: 0, containerNumbers: [], expenses: [], totals: { revenueMinor, taxMinor: 0, grandMinor: revenueMinor }, journalEntryId: 1, notes: '' })

describe('تقارير مراكز تكلفة السيارات', () => {
  it('يفصل إيرادات النقل والنولون عن التكاليف ويحسب المستحق والصافي', () => {
    const rows = buildVehicleReport([vehicle], [trip('2026-09-01', 10_000)], [
      { id: 1, vehicleId: 1, date: '2026-09-02', kind: 'internal_revenue', amountMinor: 1_000, category: 'تولون', description: 'نولون', status: 'accrued', journalEntryId: 1, settlementEntryIds: [] },
      { id: 2, vehicleId: 1, date: '2026-09-03', kind: 'cost', amountMinor: 2_500, category: 'صيانة', description: 'صيانة', status: 'paid', journalEntryId: 2, settlementEntryIds: [] },
      { id: 3, vehicleId: 1, date: '2026-09-04', kind: 'cost', amountMinor: 500, category: 'وقود', description: 'وقود', status: 'accrued', journalEntryId: 3, settlementEntryIds: [] },
    ])
    expect(rows[0]).toMatchObject({ tripRevenueMinor: 10_000, freightRevenueMinor: 1_000, operatingCostMinor: 3_000, paidCostMinor: 2_500, accruedCostMinor: 500, netMinor: 8_000 })
  })

  it('يطبق التاريخ والسيارة ونوع المصروف', () => {
    const rows = buildVehicleReport([vehicle], [trip('2026-08-01', 10_000), trip('2026-09-01', 20_000)], [
      { id: 1, vehicleId: 1, date: '2026-09-02', kind: 'cost', amountMinor: 700, category: 'وقود', description: 'وقود', status: 'paid', journalEntryId: 1, settlementEntryIds: [] },
      { id: 2, vehicleId: 1, date: '2026-08-02', kind: 'cost', amountMinor: 900, category: 'صيانة', description: 'صيانة', status: 'paid', journalEntryId: 2, settlementEntryIds: [] },
    ], { from: '2026-09-01', to: '2026-09-30', kind: 'cost', category: 'وقود' })
    expect(rows[0]).toMatchObject({ tripRevenueMinor: 20_000, operatingCostMinor: 700, netMinor: 19_300 })
    expect(vehicleReportCategories([{ id: 1, vehicleId: 1, date: '2026-09-01', kind: 'cost', amountMinor: 1, category: 'وقود', description: '', status: 'paid', journalEntryId: 1, settlementEntryIds: [] }])).toEqual(['وقود'])
  })
})
