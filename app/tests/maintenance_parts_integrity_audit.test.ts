import { beforeEach, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true, allowNegativeStock: false } })
  useDataStore.setState({ ...original, items: [], tickets: [], batches: [], journal: [] })
})

function ticket(stock = 5, cost = 3000, trackExpiry = false) {
  const s = useDataStore.getState()
  s.addItem({ nameAr: 'قطعة', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: cost, stockQty: stock, priceMinor: 5000, minQty: 0, trackExpiry, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items.at(-1)!
  const t = s.openTicket({ customerId: null, customerName: 'عميل', customerPhone: '', deviceName: 'جهاز', issue: 'عطل', estimateMinor: 0, notes: '' })
  s.setTicketStatus(t.id, 'in_progress')
  s.setTicketStatus(t.id, 'ready')
  return { s, item, t }
}

it('لا يسمح بتكرار سطور صرف القطعة لتجاوز المخزون في التسليم', () => {
  const { s, item, t } = ticket(1)
  const before = useDataStore.getState()
  expect(() => s.deliverTicket(t.id, { laborMinor: 0, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }, { itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })).toThrow(/قطعة|المخزون/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().items).toEqual(before.items)
  expect(useDataStore.getState().tickets).toEqual(before.tickets)
})

it('لا يعيد مرتجع واحد كمية مكررة تتجاوز القطعة المصروفة', () => {
  const { s, item, t } = ticket()
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  const before = useDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }, { itemId: item.id, qty: 1 }] })).toThrow(/المتبقي|المصروف|مكرر/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().items).toEqual(before.items)
  expect(useDataStore.getState().tickets).toEqual(before.tickets)
})

it('يمنع إعادة قطعة تتبع صلاحيتها بلا دليل الدفعة المصروفة', () => {
  const { s, item, t } = ticket(5, 3000, true)
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  const before = useDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })).toThrow(/الصلاحية|دفعات/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().items).toEqual(before.items)
  expect(useDataStore.getState().tickets).toEqual(before.tickets)
  expect(useDataStore.getState().batches).toEqual(before.batches)
})

it('يعيد الكمية إلى دفعتها الوحيدة المثبتة حتى لو حُذفت عند الصرف، مع مرتجعين جزئيين', () => {
  const { s, item, t } = ticket(2)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches: [{ id: 8, itemId: item.id, lotNumber: 'A', expiryDate: '2028-01-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' }] })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 2, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  expect(useDataStore.getState().batches).toHaveLength(0)
  for (let n = 0; n < 2; n++) s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })
  const state = useDataStore.getState()
  expect(state.batches).toEqual([{ id: 8, itemId: item.id, lotNumber: 'A', expiryDate: '2028-01-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' }])
  expect(state.items[0].stockQty).toBe(2)
  const entries = state.journal.filter(e => e.description.startsWith('مرتجع خدمة صيانة'))
  expect(entries.reduce((sum, e) => sum + (e.lines.find(l => l.accountCode === '1103')?.debit ?? 0), 0)).toBe(6000)
})

it('لا يخمن الدفعة العائدة إن صُرفت القطعة من دفعتين مختلفتين', () => {
  const { s, item, t } = ticket(2)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches: [
    { id: 1, itemId: item.id, expiryDate: '2028-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
    { id: 2, itemId: item.id, expiryDate: '2029-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
  ] })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 2, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  const before = useDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })).toThrow(/دفعات صلاحية/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().batches).toEqual(before.batches)
  expect(useDataStore.getState().items).toEqual(before.items)
})

it('يرفض كسور كمية القطع التي قد تكرر تقريب التكلفة', () => {
  const { s, item, t } = ticket(2, 1)
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  const before = useDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 0.5 }] })).toThrow(/عدد.*صحيح/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().items).toEqual(before.items)
})

it('يمنع صرف قطعة بسيريال دون اختيار السيريال الفعلي', () => {
  const { s, item, t } = ticket()
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackSerial: true })) })
  const before = useDataStore.getState()
  expect(() => s.deliverTicket(t.id, { laborMinor: 0, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })).toThrow(/السيريال/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().items).toEqual(before.items)
})

it('يمنع صرف قطعة من دفعة منتهية للصيانة دون اعتماد أو مسار موثق', () => {
  const { s, item, t } = ticket(1)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches: [{ id: 8, itemId: item.id, expiryDate: '2000-01-01', qty: 1, purchaseId: null, receivedAt: '1999-01-01' }] })
  const before = useDataStore.getState()
  expect(() => s.deliverTicket(t.id, { laborMinor: 0, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })).toThrow(/منته/)
  expect(useDataStore.getState().items).toEqual(before.items)
  expect(useDataStore.getState().tickets).toEqual(before.tickets)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().batches).toEqual(before.batches)
})
