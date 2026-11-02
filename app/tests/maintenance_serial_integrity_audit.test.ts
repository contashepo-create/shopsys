import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], tickets: [], batches: [], serials: [], journal: [] })
})
function fixture() {
  const s = useDataStore.getState()
  s.addItem({ nameAr: 'قطعة بسيريال', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 2, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: true, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items[0]
  useRawDataStore.setState({ serials: ['SER-1', 'SER-2'].map((serial, i) => ({ id: i + 1, itemId: item.id, serial, status: 'in_stock' as const, purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 0, receivedAt: '2026-01-01' })) })
  const t = s.openTicket({ customerId: null, customerName: 'عميل', customerPhone: '', deviceName: 'جهاز', issue: 'عطل', estimateMinor: 0, notes: '' })
  s.setTicketStatus(t.id, 'in_progress'); s.setTicketStatus(t.id, 'ready')
  return { s, item, t }
}
it('يوثق السيريالات المختارة للتسليم ويرجع المختار حصراً دون تخمين', () => {
  const { s, item, t } = fixture()
  s.deliverTicket(t.id, { laborMinor: 1000, parts: [{ itemId: item.id, qty: 2, unitPriceMinor: 1000, serials: ['SER-1', 'SER-2'] }], payment: 'cash', vatPercent: 0 })
  expect(useRawDataStore.getState().serials.map(x => x.status)).toEqual(['maintenance', 'maintenance'])
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, serials: ['SER-2'] }] })
  const after = useRawDataStore.getState()
  expect(after.serials.map(x => x.status)).toEqual(['maintenance', 'in_stock'])
  expect(after.tickets[0].returnedParts?.[0].serials).toEqual(['SER-2'])
  expect(after.items[0].stockQty).toBe(1)
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'تكرار', returnParts: [{ itemId: item.id, qty: 1, serials: ['SER-2'] }] })).toThrow(/سيريال/)
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, serials: ['SER-1'] }] })
  expect(useRawDataStore.getState().serials.every(x => x.status === 'in_stock')).toBe(true)
})
it('لا يصرف بلا تحديد جميع السيريالات ولا يقبل تكراراً أو سيريالاً لصنف آخر', () => {
  const { s, item, t } = fixture(), before = useRawDataStore.getState()
  for (const serials of [[], ['SER-1', 'SER-1'], ['SER-1', 'WRONG']]) {
    expect(() => s.deliverTicket(t.id, { laborMinor: 0, parts: [{ itemId: item.id, qty: 2, unitPriceMinor: 1000, serials }], payment: 'cash', vatPercent: 0 })).toThrow(/سيريال/)
  }
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().serials).toBe(before.serials)
})

it('يرفض جمع تتبع الصلاحية والسيريال بلا رابط مثبت بينهما', () => {
  const { s, item, t } = fixture()
  useRawDataStore.setState(state => ({ items: state.items.map(i => ({ ...i, trackExpiry: true })) }))
  const before = useRawDataStore.getState()
  expect(() => s.deliverTicket(t.id, { laborMinor: 0, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 1000, serials: ['SER-1'] }], payment: 'cash', vatPercent: 0 })).toThrow(/الصلاحية.*سيريال|السيريال.*الصلاحية/)
  expect(useRawDataStore.getState().serials).toBe(before.serials)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})

it('يحجب إرجاع السيريال إن فقد ارتباطه بالتذكرة أو فقد سجل الإرجاع السابق', () => {
  const { s, item, t } = fixture()
  s.deliverTicket(t.id, { laborMinor: 1000, parts: [{ itemId: item.id, qty: 2, unitPriceMinor: 1000, serials: ['SER-1', 'SER-2'] }], payment: 'cash', vatPercent: 0 })
  useRawDataStore.setState(state => ({ serials: state.serials.map(x => x.serial === 'SER-2' ? { ...x, maintenanceTicketId: 999 } : x) }))
  const before = useRawDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, serials: ['SER-2'] }] })).toThrow(/السيريال/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  useRawDataStore.setState({ serials: before.serials.map(x => x.serial === 'SER-2' ? { ...x, maintenanceTicketId: t.id } : x) })
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, serials: ['SER-1'] }] })
  useRawDataStore.setState(state => ({ tickets: state.tickets.map(ticket => ({ ...ticket, returnedParts: ticket.returnedParts?.map(row => ({ ...row, serials: undefined })) })) }))
  const after = useRawDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, serials: ['SER-2'] }] })).toThrow(/سيريالات مرتجع سابق/)
  expect(useRawDataStore.getState().journal).toBe(after.journal)
})
