import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mock = vi.hoisted(() => ({ changeBefore: false, failAfter: false, requirePin: false, wait: null as null | Promise<void> }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
  if (mock.wait) await mock.wait
  if (mock.changeBefore) { const { useRawDataStore } = await import('../src/data/repo.ts'); useRawDataStore.setState(s => ({ items: s.items.map(i => ({ ...i, stockQty: 1 })) })) }
  const result = commit(); if (mock.failAfter) throw new Error('flush failed'); return result
} }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: mock.requirePin, request: (cb: () => void) => cb() }) }))
import { WastagePage } from '../src/ui/pages/WastagePage.tsx'
import { ConsumptionPage } from '../src/ui/pages/ConsumptionPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
import { todayLocalIso } from '../src/core/time.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }], items: [{ id: 5, nameAr: 'صنف', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 33, stockValueMinor: 100, stockQty: 3, priceMinor: 200, minQty: 0, isActive: true }] as never, transfers: [], purchases: [], sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [], serials: [], batches: [], journal: [], wastages: [], consumptions: [] })
 mock.changeBefore = false; mock.failAfter = false; mock.requirePin = false; mock.wait = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
for (const kind of ['wastage', 'consumption'] as const) {
 const isWastage = kind === 'wastage'
 const docs = () => isWastage ? S().wastages : S().consumptions
 function open() {
  render(<MemoryRouter>{isWastage ? <WastagePage /> : <ConsumptionPage />}<ToastHost /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: isWastage ? /مستند إتلاف/ : /مستند صرف داخلي/ }))
  const date = screen.getByLabelText(isWastage ? 'تاريخ الإتلاف' : 'تاريخ الصرف الداخلي') as HTMLInputElement
  expect([date.value, date.min, date.max]).toEqual([todayLocalIso(), todayLocalIso(), todayLocalIso()])
  const dialog = date.closest('[role="dialog"]') as HTMLElement
  const select = within(dialog).getAllByRole('combobox').find(e => within(e).queryByRole('option', { name: /اختر الصنف/ })) as HTMLSelectElement
  fireEvent.change(select, { target: { value: '5' } })
  return { dialog, date, button: within(dialog).getByRole('button', { name: isWastage ? /ترحيل الإتلاف/ : /ترحيل الصرف/ }) }
 }
 it(`${kind}: ترحيل مرة واحدة مع اليوم والقيد والقيمة`, async () => {
  const { button } = open(); fireEvent.click(button); fireEvent.click(button)
  await waitFor(() => expect(docs()).toHaveLength(1)); expect(S().journal).toHaveLength(1)
  expect(docs()[0].date.slice(0, 10)).toBe(todayLocalIso()); expect(S().items[0].stockValueMinor).toBe(67)
 })
 it(`${kind}: يرفض تغيّر الرصيد ويكشف فشل تأكيد الحفظ`, async () => {
  let { button } = open(); mock.changeBefore = true; fireEvent.click(button)
  await waitFor(() => expect(screen.getByText(/تغير النموذج أو أرصدة/)).toBeTruthy()); expect(docs()).toHaveLength(0)
  cleanup(); useRawDataStore.setState({ items: S().items.map(i => ({ ...i, stockQty: 3 })) }); mock.changeBefore = false; mock.failAfter = true
  button = open().button; fireEvent.click(button)
  await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(docs()).toHaveLength(1)
  expect(screen.queryByLabelText(isWastage ? 'تاريخ الإتلاف' : 'تاريخ الصرف الداخلي')).toBeNull()
 })
 it(`${kind}: لا ينفذ نموذجاً عُدّل أثناء انتظار القفل`, async () => {
  let release!: () => void; mock.wait = new Promise<void>(resolve => { release = resolve })
  const { dialog, button } = open(); fireEvent.click(button)
  fireEvent.change(within(dialog).getByPlaceholderText(isWastage ? /رقم محضر/ : /القسم المستفيد/), { target: { value: 'تعديل أثناء الانتظار' } })
  await act(async () => { release(); await mock.wait })
  await waitFor(() => expect(screen.getByText(/تغير النموذج أو أرصدة/)).toBeTruthy()); expect(docs()).toHaveLength(0)
 })
 it(`${kind}: لا يسقط سطراً بكمية صفرية بصمت`, async () => {
  const { dialog, button } = open()
  const qty = within(dialog).getAllByRole('textbox').find(el => (el as HTMLInputElement).value === '1')!
  fireEvent.change(qty, { target: { value: '0' } }); fireEvent.click(button)
  await waitFor(() => expect(screen.getByText(/الكمية يجب أن تكون/)).toBeTruthy()); expect(docs()).toHaveLength(0)
 })
 it(`${kind}: يوضح ضرورة صلاحية المستخدم بدلاً من قبول اعتماد غير مثبت`, async () => {
  mock.requirePin = true; const { button } = open(); fireEvent.click(button)
  expect(screen.getByText(/يلزم تسجيل الدخول بمستخدم/)).toBeTruthy(); expect(docs()).toHaveLength(0)
 })
}
