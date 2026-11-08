import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReportsPage } from '../src/ui/pages/ReportsPage.tsx'
import { useToast } from '../src/ui/components/ui.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { draftFromCategory } from '../src/core/items.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const data = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  const setup = { ...app.setup, completed: true, activityId: 'spare_parts' as const, modules: ['pos', 'inventory', 'purchases'] as never[] }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], items: [{ ...draftFromCategory(undefined, 'A'), id: 1, nameAr: 'قطعة اختبار', isActive: true, isService: false }], customers: [], pendingPartOrders: [], purchaseOrders: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })
it('إدخال صفر في طلب القطعة لا يتحول سراً إلى واحد وتُقبل الأجزاء الصحيحة', () => {
  render(<MemoryRouter><ReportsPage /></MemoryRouter>)
  const button = screen.getByRole('button', { name: /تسجيل طلب عميل/ })
  const form = button.parentElement!
  const selects = within(form).getAllByRole('combobox')
  fireEvent.change(selects[0], { target: { value: '1' } })
  const customer = [...form.querySelectorAll('input')].find(input => input.previousElementSibling?.textContent === 'اسم العميل')!
  const qty = form.querySelector('input[type=number]')!
  fireEvent.change(customer, { target: { value: 'عميل' } })
  fireEvent.change(qty, { target: { value: '0' } })
  fireEvent.click(button)
  expect(useRawDataStore.getState().pendingPartOrders).toHaveLength(0)
  expect(useToast.getState().msg).toMatch(/كمية/)
  fireEvent.change(qty, { target: { value: '0.125' } })
  fireEvent.click(button)
  expect(useRawDataStore.getState().pendingPartOrders[0].qty).toBe(0.125)
})
