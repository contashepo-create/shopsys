import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { CustomersPage } from '../src/ui/pages/PartiesPages.tsx'
import { CustomerProfileSummary } from '../src/ui/components/CustomerProfileFields.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'

const initial = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
beforeEach(() => {
  useRawDataStore.setState({ ...initial, currentUserId: null, branches: [], activeBranchId: null, customers: [], priceLists: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
const customer = () => S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل قديم', phone: '', creditLimitMinor: 0, notes: '' })

it('لا يخمّن نوع أو مسؤول السجل القديم ويحفظ الملف الاختياري ويتركه في التعديلات الأخرى', () => {
  customer()
  const id = S().customers[0].id
  expect(S().customers[0].customerType).toBeUndefined()
  S().updateCustomer(id, { customerType: 'government', contactPerson: '  سارة  ', contactRole: ' مهندسة ', contactPhone: ' 050123 ', contactEmail: ' a@example.com ' })
  S().updateCustomer(id, { notes: 'ملاحظة' })
  expect(S().customers[0]).toMatchObject({ customerType: 'government', contactPerson: 'سارة', contactRole: 'مهندسة', contactPhone: '050123', contactEmail: 'a@example.com', notes: 'ملاحظة' })
  S().updateCustomer(id, { customerType: undefined })
  expect(S().customers[0].customerType).toBeUndefined()
})
it('يرفض النوع والبريد ومدخلات التحكم غير الصالحة دون تعديل السجل', () => {
  customer(); const before = S().customers
  expect(() => S().updateCustomer(before[0].id, { customerType: 'unknown' as never })).toThrow(/نوع العميل/)
  expect(() => S().updateCustomer(before[0].id, { contactEmail: 'invalid' })).toThrow(/بريد/)
  expect(() => S().updateCustomer(before[0].id, { contactPerson: 'a\nb' })).toThrow(/تواصل/)
  expect(S().customers).toBe(before)
})
it('تعديل عميل قديم من الشاشة يحفظ بيانات التواصل دون تغيير هاتف العميل', () => {
  customer()
  render(<MemoryRouter><CustomersPage /><ToastHost /></MemoryRouter>)
  fireEvent.click(screen.getByTitle('تعديل'))
  expect((screen.getByLabelText('نوع العميل') as HTMLSelectElement).value).toBe('')
  fireEvent.change(screen.getByLabelText('نوع العميل'), { target: { value: 'company' } })
  fireEvent.change(screen.getByLabelText('اسم مسؤول التواصل'), { target: { value: 'محمد' } })
  fireEvent.change(screen.getByLabelText('هاتف مسؤول التواصل'), { target: { value: '0500000' } })
  fireEvent.click(screen.getByRole('button', { name: /^حفظ/ }))
  expect(S().customers[0]).toMatchObject({ customerType: 'company', contactPerson: 'محمد', contactPhone: '0500000', phone: '' })
})
it('يوضح الملخص أنه من البطاقة الحالية وليس بيانات تاريخية للمستند', () => {
  render(<CustomerProfileSummary profile={{ customerType: 'company', contactPerson: 'محمد', contactPhone: '0500000' }} />)
  expect(screen.getByText(/بيانات العميل الحالية: شركة · مسؤول التواصل: محمد · 0500000/)).toBeTruthy()
})
