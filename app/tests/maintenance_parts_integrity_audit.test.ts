import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { buildBackup, parseBackup } from '../src/core/backup.ts'
import { secureStorage, flushSecureStorageWrites } from '../src/data/secureStorage.ts'
import { assertJournalSnapshotSafe } from '../src/core/ledgerSnapshotGuard.ts'

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

it('يعيد كل دفعات القطعة عند إرجاع كامل الكمية المصروفة دون تخمين الدفعة', () => {
  const { s, item, t } = ticket(2)
  const batches = [
    { id: 7, itemId: item.id, lotNumber: 'A', expiryDate: '2028-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
    { id: 8, itemId: item.id, lotNumber: 'B', expiryDate: '2029-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
  ]
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 2, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  expect(useDataStore.getState().batches).toHaveLength(0)
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 10000, mode: 'cash', reason: 'إرجاع الكمية كلها', returnParts: [{ itemId: item.id, qty: 2 }] })
  expect(useDataStore.getState().batches).toEqual(batches)
  expect(useDataStore.getState().items[0].stockQty).toBe(2)
  expect(useDataStore.getState().journal.at(-1)?.lines.find(l => l.accountCode === '1103')?.debit).toBe(6000)
})

it('يرجع جزءاً من دفعات مختلطة باختيار الدفعة الفعلية ويسجلها ويمنع تكرارها', () => {
  const { s, item, t } = ticket(3)
  const batches = [
    { id: 7, itemId: item.id, lotNumber: 'A', expiryDate: '2028-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
    { id: 8, itemId: item.id, lotNumber: 'B', expiryDate: '2029-01-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' },
  ]
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 3, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  const call = (batchId: number) => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'دفعة محددة', returnParts: [{ itemId: item.id, qty: 1, batches: [{ batchId, qty: 1 }] }] })
  call(8)
  expect(useDataStore.getState().batches).toEqual([{ ...batches[1], qty: 1 }])
  expect(useDataStore.getState().tickets[0].returnedParts?.at(-1)).toMatchObject({ itemId: item.id, qty: 1, batches: [{ batchId: 8, qty: 1 }] })
  call(7)
  const before = useDataStore.getState()
  expect(() => call(7)).toThrow(/دفعة|المتبقي/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().items).toEqual(before.items)
  expect(useDataStore.getState().batches).toEqual(before.batches)
  call(8)
  expect(useDataStore.getState().items[0].stockQty).toBe(3)
  expect(useDataStore.getState().batches.sort((a, b) => a.id - b.id)).toEqual(batches)
})

it('ينقص قيمة المخزون مع قطع الصيانة ثم يعيدها عند المرتجع دون زيادة وهمية', () => {
  const { s, item, t } = ticket(3)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, stockValueMinor: 9000 })) })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 2, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  expect(useDataStore.getState().items[0]).toMatchObject({ stockQty: 1, stockValueMinor: 3000 })
  expect(useDataStore.getState().journal.at(-1)?.lines.find(l => l.accountCode === '1103')?.credit).toBe(6000)
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })
  expect(useDataStore.getState().items[0]).toMatchObject({ stockQty: 2, stockValueMinor: 6000, costMinor: 3000 })
})

it('يطابق تكلفة صرف ومرتجعات قطع الصيانة مع القيمة الدقيقة عند وجود كسور متوسط', () => {
  const { s, item, t } = ticket(3, 33)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, stockValueMinor: 100 })) })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 3, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  expect(useDataStore.getState().items[0].stockValueMinor).toBe(0)
  expect(useDataStore.getState().journal.at(-1)?.lines.find(l => l.accountCode === '1103')?.credit).toBe(100)
  for (let i = 0; i < 3; i++) s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })
  expect(useDataStore.getState().items[0].stockValueMinor).toBe(100)
  expect(useDataStore.getState().journal.filter(e => e.description.startsWith('مرتجع خدمة صيانة')).reduce((sum, e) => sum + (e.lines.find(l => l.accountCode === '1103')?.debit ?? 0), 0)).toBe(100)
})

it('لا يسجل مرتجع صيانة في فرع آخر ولا يغير بياناته', () => {
  const { s, item, t } = ticket(1)
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  const beforeBranches = useRawDataStore.getState()
  useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }] as never, activeBranchId: 1, tickets: beforeBranches.tickets.map(row => ({ ...row, branchId: 2 })) })
  try {
    const before = useRawDataStore.getState()
    expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })).toThrow(/فرع|التذكرة/)
    expect(useRawDataStore.getState().journal).toBe(before.journal)
    expect(useRawDataStore.getState().items).toBe(before.items)
    expect(useRawDataStore.getState().tickets).toBe(before.tickets)
  } finally { useRawDataStore.setState({ branches: [], activeBranchId: null }) }
})

it('يرفض جعل حساب مصروف خزينةً لمرتجع الصيانة دون كتابة', () => {
  const { s, t } = ticket(1)
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [], payment: 'cash', vatPercent: 0 })
  const before = useRawDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', treasury: '5108', reason: 'رد' })).toThrow(/الخزينة|البنك/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().tickets).toBe(before.tickets)
})

it('يحجب مرتجع قطعة جديداً إذا فُقد قيد المرتجع السابق ولا يخمن تكلفة ردها', () => {
  const { s, item, t } = ticket(3, 33)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, stockValueMinor: 100 })) })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 3, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })
  useRawDataStore.setState(state => ({ journal: state.journal.filter(e => !e.description.startsWith('مرتجع خدمة صيانة')) }))
  const before = useRawDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1 }] })).toThrow(/مرتجع.*سابق|قيد/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().items).toBe(before.items)
})

it('يرفض اختيار دفعات مكررة أو خاطئة أو لا يساوي مجموعها كمية القطعة بلا أثر', () => {
  const { s, item, t } = ticket(3)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches: [
    { id: 7, itemId: item.id, lotNumber: 'A', expiryDate: '2028-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
    { id: 8, itemId: item.id, lotNumber: 'B', expiryDate: '2029-01-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' },
  ] })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 3, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  const before = useRawDataStore.getState()
  for (const batches of [[], [{ batchId: 99, qty: 1 }], [{ batchId: 7, qty: 0.5 }, { batchId: 7, qty: 0.5 }], [{ batchId: 7, qty: 0.5 }], [{ batchId: 7, qty: 1.5 }]]) {
    expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, batches }] })).toThrow(/دفعة|دفعات|الدفعات/)
    expect(useRawDataStore.getState().journal).toBe(before.journal)
    expect(useRawDataStore.getState().items).toBe(before.items)
    expect(useRawDataStore.getState().batches).toBe(before.batches)
  }
})

it('يستعيد كمية صحيحة من كسور دفعتين بعد تحديدهما صراحة', () => {
  const { s, item, t } = ticket(1)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches: [
    { id: 7, itemId: item.id, lotNumber: 'A', expiryDate: '2028-01-01', qty: 0.4, purchaseId: null, receivedAt: '2026-01-01' },
    { id: 8, itemId: item.id, lotNumber: 'B', expiryDate: '2029-01-01', qty: 0.6, purchaseId: null, receivedAt: '2026-01-01' },
  ] })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, batches: [{ batchId: 7, qty: 0.4 }, { batchId: 8, qty: 0.6 }] }] })
  expect(useDataStore.getState().batches.map(batch => batch.qty)).toEqual([0.4, 0.6])
  expect(useDataStore.getState().items[0].stockQty).toBe(1)
})

it('يرفض استمرار مرتجع مختلط قديم لا يحدد دفعاته السابقة حتى لو اختيرت دفعة جديدة', () => {
  const { s, item, t } = ticket(3)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true })), batches: [
    { id: 7, itemId: item.id, expiryDate: '2028-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
    { id: 8, itemId: item.id, expiryDate: '2029-01-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' },
  ] })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 3, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  useRawDataStore.setState(state => ({ tickets: state.tickets.map(row => ({ ...row, parts: row.parts.map(p => ({ ...p, costTotalMinor: undefined })), returnedParts: [{ itemId: item.id, qty: 1, at: '2026-01-01' }] })) }))
  const before = useRawDataStore.getState()
  expect(() => s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, batches: [{ batchId: 7, qty: 1 }] }] })).toThrow(/دفعات مرتجع سابق/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  expect(useRawDataStore.getState().batches).toBe(before.batches)
})

it('يحفظ تفاصيل الدفعة وتكلفتها وقيدها في النسخة وإعادة التحميل ويواصل المرتجع', async () => {
  const { s, item, t } = ticket(3, 33)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, trackExpiry: true, stockValueMinor: 100 })), batches: [
    { id: 7, itemId: item.id, lotNumber: 'A', expiryDate: '2028-01-01', qty: 1, purchaseId: null, receivedAt: '2026-01-01' },
    { id: 8, itemId: item.id, lotNumber: 'B', expiryDate: '2029-01-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' },
  ] })
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 3, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد', returnParts: [{ itemId: item.id, qty: 1, batches: [{ batchId: 8, qty: 1 }] }] })
  await flushSecureStorageWrites('shopsys-data')
  const stored = await secureStorage.getItem('shopsys-data')
  expect(stored).toBeTruthy()
  const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 25, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  expect(() => assertJournalSnapshotSafe((restored.data.store as { state: Record<string, unknown> }).state)).not.toThrow()
  useRawDataStore.setState({ tickets: [], items: [], journal: [], batches: [] })
  await flushSecureStorageWrites('shopsys-data')
  await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
  await useRawDataStore.persist.rehydrate()
  expect(useDataStore.getState().tickets[0].returnedParts?.[0]).toMatchObject({ qty: 1, costMinor: 33, batches: [{ batchId: 8, qty: 1 }] })
  useDataStore.getState().refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد ثان', returnParts: [{ itemId: item.id, qty: 1, batches: [{ batchId: 7, qty: 1 }] }] })
  expect(useDataStore.getState().items[0].stockValueMinor).toBe(67)
})

it('لا يعيد تقييم المخزون الحالي عند رد قطعة تكلفتها صفر', () => {
  const { s, item, t } = ticket(1, 0)
  s.deliverTicket(t.id, { laborMinor: 10000, parts: [{ itemId: item.id, qty: 1, unitPriceMinor: 5000 }], payment: 'cash', vatPercent: 0 })
  // محاكاة وصول مخزون لاحق بقيمة دقيقة لا تقبل القسمة بالتساوي.
  useRawDataStore.setState(state => ({ items: state.items.map(i => ({ ...i, stockQty: 2, costMinor: 51, stockValueMinor: 101 })) }))
  s.refundMaintenanceTicket({ ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'رد قطعة مجانية', returnParts: [{ itemId: item.id, qty: 1 }] })
  expect(useRawDataStore.getState().items[0]).toMatchObject({ stockQty: 3, costMinor: 34, stockValueMinor: 101 })
})
