/**
 * §98: عمولات الموظفين تُعدَّل وتُلغى من نوافذ النظام — لا prompt() الأصلية.
 *
 * كانت أزرار «تعديل» و«إلغاء» عمولة الموظف تستدعيان window.prompt مرتين متتاليتين
 * (مبلغ ثم سبب) فتكسر نمط البرنامج: نوافذ المتصفح الأصلية تحجب الصفحة، لا تتحقق
 * من المدخل، وتظهر بإنجليزية أزرار النظام. الاختبار يثبت المسار الجديد كاملاً:
 * زر التعديل ← نافذة بحقلين ← اعتماد ← عمولة جديدة بأثر تدقيقي، وزر الإلغاء ←
 * سبب إلزامي ← قيد عاكس.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { EmployeesPage } = await import('../src/ui/pages/EmployeesPage.tsx')

const original = useDataStore.getState()
const employee = { id: 901, nameAr: 'عمرو مندوب المبيعات', phone: '01000000001', jobTitle: 'مندوب', hireDate: '2025-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '' }

const accrue = (id: number, amountMinor: number) => ({
  id, code: `COM-${String(id).padStart(4, '0')}`, employeeId: employee.id, source: 'manual', sourceId: null,
  description: 'عمولة بيع مباشر', amountMinor, status: 'accrued', date: '2026-10-01', journalEntryId: id,
  payoutMode: null, paidVoucherId: null, cancelReason: null,
})

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  useDataStore.setState({
    ...original,
    employees: [employee] as never,
    staffCommissions: [accrue(1, 150000), accrue(2, 80000)] as never,
    journal: [],
    treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 1_000_000, isDefault: true }] as never,
  })
})
afterEach(() => cleanup())

describe('نوافذ تعديل وإلغاء عمولة الموظف (لا prompt أصلية)', () => {
  it('لا prompt() أصلية في شاشة الموظفين إطلاقاً', async () => {
    const source = readFileSync(join(here, '..', 'src', 'ui', 'pages', 'EmployeesPage.tsx'), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') /* تعليقات JSX */
      .replace(/\/\*[\s\S]*?\*\//g, '') /* تعليقات كتلية */
      .replace(/^\s*\/\/.*$/gm, '') /* تعليقات سطرية */
    expect(source).not.toMatch(/(?<![\w.])prompt\s*\(/)
  })

  it('تعديل العمولة: نافذة بحقلين واعتمادها يولّد عمولة جديدة بمبلغ معدل', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('prompt الأصلية ممنوعة — استخدم النافذة') })
    try {
      render(<MemoryRouter><EmployeesPage initialTab="commissions" /></MemoryRouter>)
      const row = screen.getByText('COM-0001').closest('tr')!
      fireEvent.click(within(row).getByTitle('تعديل المبلغ (إلغاء + استحقاق جديد بأثر تدقيقي)'))

      const amountInput = screen.getByLabelText('المبلغ الجديد') as HTMLInputElement
      const reasonInput = screen.getByLabelText('سبب التعديل') as HTMLInputElement
      expect(amountInput.value).toBe('1500') /* 150000 قرش = 1,500 ج */
      fireEvent.change(amountInput, { target: { value: '2000' } })
      fireEvent.change(reasonInput, { target: { value: 'تصحيح النسبة مع العميل' } })
      fireEvent.click(screen.getByRole('button', { name: /اعتماد التعديل/ }))

      const state = useDataStore.getState()
      /* القديمة أُلغيت والجديدة بالمبلغ المعدل ووسم التعديل */
      expect(state.staffCommissions.find((c) => c.id === 1)?.status).toBe('cancelled')
      const fresh = state.staffCommissions.find((c) => c.description.includes('معدلة من COM-0001'))
      expect(fresh?.amountMinor).toBe(200000)
      expect(fresh?.status).toBe('accrued')
      /* القيد العاكس + قيد الاستحقاق الجديد وُلدا */
      expect(state.journal.length).toBeGreaterThanOrEqual(2)
    } finally {
      promptSpy.mockRestore()
      cleanup()
    }
  })

  it('إلغاء العمولة: السبب إلزامي ثم قيد عاكس يطفئها', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('prompt الأصلية ممنوعة — استخدم النافذة') })
    try {
      render(<MemoryRouter><EmployeesPage initialTab="commissions" /></MemoryRouter>)
      const row = screen.getByText('COM-0002').closest('tr')!
      fireEvent.click(within(row).getByTitle('إلغاء العمولة (قيد عاكس + سبب موثق)'))

      /* بلا سبب: يُرفض وتبقى النافذة */
      fireEvent.click(screen.getByRole('button', { name: /إلغاء العمولة/, exact: false }))
      expect(useDataStore.getState().staffCommissions.find((c) => c.id === 2)?.status).toBe('accrued')

      fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'أُلغيت العملية المرتبطة' } })
      fireEvent.click(screen.getByRole('button', { name: /إلغاء العمولة/, exact: false }))

      const cancelled = useDataStore.getState().staffCommissions.find((c) => c.id === 2)
      expect(cancelled?.status).toBe('cancelled')
      expect(cancelled?.cancelReason).toBe('أُلغيت العملية المرتبطة')
      expect(useDataStore.getState().journal.length).toBeGreaterThanOrEqual(1)
    } finally {
      promptSpy.mockRestore()
      cleanup()
    }
  })
})
