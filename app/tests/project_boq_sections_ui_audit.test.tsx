import { afterEach, beforeEach, expect, it } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const data = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
  const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], projects: [], boqItems: [], projectExtracts: [], advancedInvoiceDrafts: [], customers: [], employees: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })
const open = () => { render(<MemoryRouter><ProjectsPage /></MemoryRouter>); fireEvent.click(screen.getByText('مشروع جديد')) }
const fillLine = (row: Element, description: string, qty: string, price: string) => {
  const inputs = row.querySelectorAll('input')
  fireEvent.change(inputs[1], { target: { value: description } })
  fireEvent.change(inputs[3], { target: { value: qty } })
  fireEvent.change(inputs[4], { target: { value: price } })
}
it('أقسام متعددة تحفظ البنود وقيمة العقد دون عد العنوان بنداً', () => {
  open()
  expect(document.querySelector('[data-project-boq-scroll]')?.classList.contains('project-boq-scroll')).toBe(true)
  fireEvent.change(screen.getByPlaceholderText('فيلا الشيخ زايد…'), { target: { value: 'مشروع الأدوار' } })
  fireEvent.click(screen.getByRole('button', { name: /عنوان قسم/ }))
  fireEvent.change(screen.getByLabelText('عنوان القسم'), { target: { value: 'الدور الأول' } })
  const section1 = document.querySelectorAll('[data-boq-section]')[1]
  fillLine(section1.querySelector('[data-project-boq-line]')!, 'دهانات', '10', '5')
  fireEvent.click(screen.getByRole('button', { name: /عنوان قسم/ }))
  fireEvent.change(screen.getAllByLabelText('عنوان القسم')[1], { target: { value: 'الدور الثاني' } })
  const section2 = document.querySelectorAll('[data-boq-section]')[2]
  fillLine(section2.querySelector('[data-project-boq-line]')!, 'سباكة', '2', '15')
  expect(within(section1 as HTMLElement).getByText(/مجموع القسم/).textContent).toContain('50')
  fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
  const project = useRawDataStore.getState().projects[0]
  expect(project.contractValueMinor).toBe(8000)
  expect(project.boqSections?.map(section => section.nameAr)).toEqual(['الدور الأول', 'الدور الثاني'])
  expect(useRawDataStore.getState().boqItems.map(item => [item.descriptionAr, item.sectionId])).toEqual([['دهانات', project.boqSections![0].id], ['سباكة', project.boqSections![1].id]])
})
it('لا يتجاهل بنداً غير مكتمل عند إنشاء المشروع', () => {
  open()
  fireEvent.change(screen.getByPlaceholderText('فيلا الشيخ زايد…'), { target: { value: 'مشروع' } })
  fillLine(document.querySelector('[data-project-boq-line]')!, 'كامل', '2', '5')
  fireEvent.click(screen.getByRole('button', { name: /^\+ بند جديد$/ }))
  const second = document.querySelectorAll('[data-project-boq-line]')[1]
  fireEvent.change(second.querySelectorAll('input')[1], { target: { value: 'بند غير مكتمل' } })
  fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
  expect(screen.getByText(/أكمل أو احذف بنود/)).toBeTruthy()
  expect(useRawDataStore.getState().projects).toHaveLength(0)
})
it('مسودة المشروع تستعيد الأقسام والبنود وتحذف نفس المسودة عند الإنشاء', () => {
  open()
  fireEvent.change(screen.getByPlaceholderText('فيلا الشيخ زايد…'), { target: { value: 'مشروع مسودة' } })
  fireEvent.click(screen.getByRole('button', { name: /عنوان قسم/ }))
  fireEvent.change(screen.getByLabelText('عنوان القسم'), { target: { value: 'الدور الأول' } })
  fillLine(document.querySelectorAll('[data-boq-section]')[1].querySelector('[data-project-boq-line]')!, 'دهانات', '10', '5')
  fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
  expect(useRawDataStore.getState().advancedInvoiceDrafts).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('عنوان القسم'), { target: { value: 'مؤقت' } })
  fireEvent.click(screen.getByRole('button', { name: /المسودات/ }))
  fireEvent.click(screen.getByRole('button', { name: 'فتح' }))
  expect((screen.getByLabelText('عنوان القسم') as HTMLInputElement).value).toBe('الدور الأول')
  expect(screen.getByDisplayValue('دهانات')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))
  expect(useRawDataStore.getState().advancedInvoiceDrafts).toHaveLength(0)
  expect(useRawDataStore.getState().boqItems[0].descriptionAr).toBe('دهانات')
})
it('يمكن نقل بند لقسم آخر دون فقد بياناته', () => {
  open()
  fillLine(document.querySelector('[data-project-boq-line]')!, 'نقل آمن', '3', '2')
  fireEvent.click(screen.getByRole('button', { name: /عنوان قسم/ }))
  fireEvent.change(screen.getByLabelText('عنوان القسم'), { target: { value: 'الدور الأول' } })
  const row = screen.getByDisplayValue('نقل آمن').closest('[data-project-boq-line]')!
  fireEvent.change(within(row as HTMLElement).getByLabelText('قسم البند'), { target: { value: (screen.getByLabelText('عنوان القسم').closest('[data-boq-section]') as HTMLElement).dataset.boqSectionId } })
  const group = screen.getByLabelText('عنوان القسم').closest('[data-boq-section]')!
  expect(within(group as HTMLElement).getByDisplayValue('نقل آمن')).toBeTruthy()
})
it('حذف العنوان يتطلب تأكيداً وينقل البنود إلى غير مصنفة', () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: /عنوان قسم/ }))
  fireEvent.change(screen.getByLabelText('عنوان القسم'), { target: { value: 'دور' } })
  fillLine(document.querySelectorAll('[data-boq-section]')[1].querySelector('[data-project-boq-line]')!, 'دهانات', '10', '5')
  fireEvent.click(screen.getByTitle('حذف القسم'))
  expect(screen.getByText(/تنقل البنود إلى غير مصنفة/)).toBeTruthy()
  fireEvent.click(screen.getByText('تأكيد حذف القسم'))
  expect(screen.getByDisplayValue('دهانات')).toBeTruthy()
  expect(screen.queryByLabelText('عنوان القسم')).toBeNull()
})
