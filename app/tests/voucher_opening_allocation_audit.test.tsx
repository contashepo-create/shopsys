import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VouchersPage } from '../src/ui/pages/VouchersPage.tsx'
import { useDataStore, EMPTY_EXTENDED } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useDataStore.getState()
const appOriginal = useAppStore.getState()
beforeEach(() => {
  localStorage.clear()
  useDataStore.setState({ ...original, customers: [], sales: [], projects: [], projectExtracts: [], vouchers: [], cheques: [], clientSettlements: [], journal: [], openingBalances: {} })
  useAppStore.setState({ ...appOriginal, setup: { ...appOriginal.setup, countryCode: 'EG', activityId: 'general', modules: ['pos', 'inventory', 'purchases'] } })
})
afterEach(() => { cleanup(); useDataStore.setState(original); useAppStore.setState(appOriginal) })

it('جدول تخصيص السند يعرض إجمالي الافتتاحي نفسه لا يضيف المسدد إليه مرة ثانية', () => {
  const store = () => useDataStore.getState()
  store().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل تدقيق', phone: '', creditLimitMinor: 0, notes: '' })
  const cust = store().customers.at(-1)!
  store().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 10000, label: cust.nameAr })
  store().receiveCheque({ chequeNumber: 'UI-01', partyId: cust.id, bankName: 'بنك', amountMinor: 2500, dueDate: '2026-11-01', notes: '' })
  const view = render(<MemoryRouter><VouchersPage /></MemoryRouter>)
  fireEvent.click(view.getAllByText(/سند قبض/)[0].closest('button')!)
  const counter = document.querySelector('select[aria-label="بحث الحساب المقابل"]') as HTMLSelectElement | null
  if (counter) fireEvent.change(counter, { target: { value: '1104' } })
  else {
    const search = view.getByLabelText('بحث الحساب المقابل')
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: '1104' } })
    const option = document.querySelector('[data-quick-option][data-value="1104"]') as HTMLElement
    fireEvent.click(option)
  }
  const picker = view.getByLabelText('بحث العميل')
  fireEvent.change(picker, { target: { value: 'عميل' } })
  const option = document.querySelector(`[data-quick-option][data-value="${cust.id}"]`) as HTMLElement
  expect(option).toBeTruthy()
  fireEvent.click(option)
  const section = document.querySelector('[data-voucher-allocation-section]') as HTMLElement
  expect(section).toBeTruthy()
  const row = section.querySelector('tbody tr')!
  const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim())
  expect(cells[3]).toBe('100.00')
  expect(cells[4]).toBe('25.00')
  expect(cells[5]).toBe('75.00')
  expect(cells[2]).not.toBe('0000-00-00')
  const total = [...section.querySelectorAll('tfoot td')].map((cell) => cell.textContent?.trim())
  expect(total[1]).toBe('100.00')
})
