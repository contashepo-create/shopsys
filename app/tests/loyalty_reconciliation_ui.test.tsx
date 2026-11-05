import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CustomersPage } from '../src/ui/pages/PartiesPages.tsx'
import { useDataStore, EMPTY_EXTENDED } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { buildReversalLines } from '../src/core/ledger.ts'

const original = useDataStore.getState()
const appOriginal = useAppStore.getState()
beforeEach(() => {
  useDataStore.setState({ ...original, customers: [], journal: [], loyaltyRedemptions: [], sales: [], saleReturns: [], vouchers: [], cheques: [], clientSettlements: [], openingBalances: {}, branches: [], appUsers: [], currentUserId: null })
  useAppStore.setState({ ...appOriginal, setup: { ...appOriginal.setup, countryCode: 'EG' } })
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { loyalty: { enabled: true, redeemValueMinor: 5, minRedeemPoints: 100 } } }))
})
afterEach(() => { cleanup(); useDataStore.setState(original); useAppStore.setState(appOriginal) })

it('مراجعة عكس الولاء تتطلب السبب والإقرار ثم تستعيد النقاط مرة واحدة', () => {
  const S = () => useDataStore.getState()
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل المراجعة', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = S().customers.at(-1)!
  useDataStore.setState({ customers: S().customers.map((c) => c.id === customer.id ? { ...c, loyaltyPoints: 800 } : c) })
  const red = S().redeemLoyaltyPoints(customer.id, 800)
  const entry = S().journal.find((e) => e.id === red.journalEntryId)!
  const reverse = { ...entry, id: entry.id + 1, entryNumber: entry.entryNumber + 1, date: '2026-10-28', sourceType: 'reversal' as const, sourceId: entry.id, lines: buildReversalLines(entry.lines), reversedByEntryId: null, reversesEntryId: entry.id }
  useDataStore.setState({ journal: S().journal.map((e) => e.id === entry.id ? { ...e, reversedByEntryId: reverse.id } : e).concat(reverse) })
  render(<MemoryRouter><CustomersPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /مراجعة نقاط الولاء \(1\)/ }))
  const save = screen.getByRole('button', { name: /حفظ المراجعة/ }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('سبب المراجعة'), { target: { value: 'مراجعة سجل العميل' } })
  expect(save.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /تحققت من رصيد النقاط/ }))
  expect(save.disabled).toBe(false)
  fireEvent.click(save)
  expect(S().customers.find((c) => c.id === customer.id)?.loyaltyPoints).toBe(800)
  expect(screen.queryByRole('button', { name: /مراجعة نقاط الولاء/ })).toBeNull()
})
