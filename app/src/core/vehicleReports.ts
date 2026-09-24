import type { Trip, Vehicle, VehicleCostCenterEntry } from '../data/repo.ts'

export type VehicleReportKind = 'all' | 'internal_revenue' | 'cost'

export interface VehicleReportFilters {
  from?: string
  to?: string
  vehicleId?: number | null
  kind?: VehicleReportKind
  category?: string
}

export interface VehicleReportRow {
  vehicleId: number
  tripRevenueMinor: number
  freightRevenueMinor: number
  operatingCostMinor: number
  accruedCostMinor: number
  paidCostMinor: number
  totalRevenueMinor: number
  netMinor: number
  tripCount: number
  costEntryCount: number
}

function inRange(date: string, from?: string, to?: string): boolean {
  const day = date.slice(0, 10)
  return (!from || day >= from) && (!to || day <= to)
}

function categoryOf(entry: VehicleCostCenterEntry): string {
  return entry.category?.trim() || entry.description.trim() || 'other'
}

/**
 * تقرير تشغيلي خالص لمركز تكلفة المركبات.
 * إيراد الرحلات + تحميلات/نولون الفواتير = إجمالي الإيرادات التشغيلية.
 * سندات الصرف والمصاريف المرتبطة بالمركبة = تكاليف، مع فصل المستحق عن المسدد.
 */
export function buildVehicleReport(
  vehicles: readonly Vehicle[],
  trips: readonly Trip[],
  entries: readonly VehicleCostCenterEntry[],
  filters: VehicleReportFilters = {},
): VehicleReportRow[] {
  const selectedVehicles = vehicles.filter((vehicle) => filters.vehicleId == null || vehicle.id === filters.vehicleId)
  const scopedTrips = trips.filter((trip) => trip.vehicleId != null && inRange(trip.date, filters.from, filters.to))
  const scopedEntries = entries.filter((entry) => {
    if (!inRange(entry.date, filters.from, filters.to)) return false
    if (filters.vehicleId != null && entry.vehicleId !== filters.vehicleId) return false
    if (filters.kind && filters.kind !== 'all' && entry.kind !== filters.kind) return false
    if (filters.category && filters.category !== 'all' && categoryOf(entry) !== filters.category) return false
    return true
  })
  return selectedVehicles.map((vehicle) => {
    const vehicleTrips = scopedTrips.filter((trip) => trip.vehicleId === vehicle.id)
    const vehicleEntries = scopedEntries.filter((entry) => entry.vehicleId === vehicle.id)
    const tripRevenueMinor = vehicleTrips.reduce((sum, trip) => sum + trip.totals.revenueMinor, 0)
    const freightRevenueMinor = vehicleEntries.filter((entry) => entry.kind === 'internal_revenue').reduce((sum, entry) => sum + entry.amountMinor, 0)
    const costEntries = vehicleEntries.filter((entry) => entry.kind === 'cost')
    const operatingCostMinor = costEntries.reduce((sum, entry) => sum + entry.amountMinor, 0)
    const paidCostMinor = costEntries.filter((entry) => entry.status === 'paid').reduce((sum, entry) => sum + entry.amountMinor, 0)
    const accruedCostMinor = operatingCostMinor - paidCostMinor
    const totalRevenueMinor = tripRevenueMinor + freightRevenueMinor
    return {
      vehicleId: vehicle.id,
      tripRevenueMinor,
      freightRevenueMinor,
      operatingCostMinor,
      accruedCostMinor,
      paidCostMinor,
      totalRevenueMinor,
      netMinor: totalRevenueMinor - operatingCostMinor,
      tripCount: vehicleTrips.length,
      costEntryCount: costEntries.length,
    }
  })
}

export function vehicleReportCategories(entries: readonly VehicleCostCenterEntry[]): string[] {
  return [...new Set(entries.map(categoryOf))].sort((a, b) => a.localeCompare(b, 'ar'))
}

export function vehicleReportCategory(entry: VehicleCostCenterEntry): string {
  return categoryOf(entry)
}
