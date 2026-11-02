import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ServiceRefundBox } from '../src/ui/components/ServiceRefundBox.tsx'
import { maintenanceRefundChoices } from '../src/core/maintenanceRefundChoices.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'
const app = useAppStore.getState(), raw = useRawDataStore.getState()
afterEach(() => { cleanup(); useAppStore.setState(app); useRawDataStore.setState(raw) })

it('يختار كمية دفعة محددة ويحافظ على مقام الفاتورة الأصلية بعد مرتجع سابق', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG' } })
  const ticket = { totals: { laborMinor: 10000 }, services: [], parts: [{ itemId: 1, nameAr: 'بطارية', qty: 3, unitPriceMinor: 5000, unitCostMinor: 3000 }], partExpiryBatches: [
    { id: 7, itemId: 1, lotNumber: 'A', expiryDate: '2028-01-01', qty: 1 },
    { id: 8, itemId: 1, lotNumber: 'B', expiryDate: '2029-01-01', qty: 2 },
  ], returnedParts: [{ itemId: 1, qty: 1, at: '2026-01-01', batches: [{ batchId: 8, qty: 1 }] }] } as never
  useRawDataStore.setState({ appUsers: [], currentUserId: null })
  const choices = maintenanceRefundChoices(ticket)
  const onSubmit = vi.fn()
  render(<ServiceRefundBox grandMinor={25000} refundedMinor={5000} currencySymbol="ج" fmt={String} allowCredit={false} refundableItems={choices.items} partialQuantityKeys={choices.partKeys} referenceValueMinor={25000} onSubmit={onSubmit} />)
  fireEvent.click(screen.getByRole('button', { name: /دفعة A/ }))
  const quantity = screen.getByLabelText(/كمية قطعة: بطارية — دفعة A/)
  fireEvent.change(quantity, { target: { value: '0' } })
  expect((screen.getByRole('button', { name: /تنفيذ المرتجع/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(quantity, { target: { value: '1' } })
  expect((screen.getByRole('button', { name: /تنفيذ المرتجع/ }) as HTMLButtonElement).disabled).toBe(false)
  expect(within(screen.getByText('المبلغ المردود (بنسبة البنود من الإجمالي النهائي)').parentElement!).getByText(/5000/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /تنفيذ المرتجع/ }))
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 5000, selectedKeys: ['part:0:batch:7'], selectedQuantities: { 'part:0:batch:7': 1 } }))
})

it('يعرض سيريال القطعة المتبقي للاختيار الفردي ويحفظ مفتاحه عند الإرسال', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG' } })
  useRawDataStore.setState({ appUsers: [], currentUserId: null })
  const choices = maintenanceRefundChoices({ totals: { laborMinor: 1000 }, parts: [{ itemId: 1, nameAr: 'قطعة', qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, serials: ['SER-1', 'SER-2'] }], returnedParts: [{ itemId: 1, qty: 1, serials: ['SER-1'] }] })
  const onSubmit = vi.fn()
  render(<ServiceRefundBox grandMinor={3000} refundedMinor={1000} currencySymbol="ج" fmt={String} allowCredit={false} refundableItems={choices.items} partialQuantityKeys={choices.partKeys} referenceValueMinor={3000} onSubmit={onSubmit} />)
  expect(screen.queryByRole('button', { name: /SER-1/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /SER-2/ }))
  expect(screen.queryByLabelText(/كمية.*SER-2/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /تنفيذ المرتجع/ }))
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1000, selectedKeys: ['part:0:serial:SER-2'] }))
  expect(choices.parts['part:0:serial:SER-2']).toEqual({ itemId: 1, serial: 'SER-2' })
})
