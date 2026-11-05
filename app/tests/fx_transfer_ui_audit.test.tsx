import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FxTreasuryTab } from '../src/ui/pages/FxTreasuryTab.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يتيح تحويل نفس العملة بين خزانتين ثم عكس آخر تحويل بسبب صريح', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }, fxRates: {} })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] })
  const s = useDataStore.getState(), dest = s.addTreasury('خزينة التحويل', 'cash')
  s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4101', amountMinor: 10000, description: 'حيازة', fx: { currencyCode: 'KWD', amountMinor: 1000, ratePpm: 100000000, decimals: 3 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  render(<FxTreasuryTab cur={{ code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }} companyName="متجر" />)
  fireEvent.click(screen.getByRole('button', { name: /تحويل عملة/ }))
  fireEvent.change(screen.getByLabelText('العملة المصروفة'), { target: { value: 'KWD' } })
  fireEvent.change(screen.getByLabelText('العملة المستلمة'), { target: { value: 'KWD' } })
  const modal = screen.getByRole('dialog')
  const lists = within(modal as HTMLElement).getAllByRole('combobox')
  fireEvent.change(lists[3], { target: { value: dest.code } })
  fireEvent.change(document.querySelector('[data-fx-conv-amount]')!, { target: { value: '0.250' } })
  expect((document.querySelector('[data-fx-conv-post]') as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(document.querySelector('[data-fx-conv-post]')!)
  expect(useDataStore.getState().fxConversions[0].kind).toBe('treasury_transfer')
  fireEvent.click(screen.getByRole('button', { name: 'تصحيح التحويل' }))
  expect((screen.getByRole('button', { name: /تأكيد عكس التحويل/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('سبب تصحيح التحويل'), { target: { value: 'التحويل لم يتم' } })
  fireEvent.click(screen.getByRole('button', { name: /تأكيد عكس التحويل/ }))
  expect(s.getFxHoldings()).toEqual([expect.objectContaining({ treasury: '1101', amountMinor: 1000, bookValueMinor: 10000 })])
})
