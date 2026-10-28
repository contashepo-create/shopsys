import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'
import { FinancialDataReviewBoundary } from '../src/ui/components/FinancialDataReviewBoundary.tsx'

it('يعرض رسالة مراجعة واضحة ويحجب القيمة ثم يعيد العرض بعد إصلاح البيانات', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  let damaged = true
  function CustomerBalance() {
    if (damaged) throw new FinancialDataReviewError('طلب المعمل LAB-1')
    return <span>الرصيد 1200</span>
  }
  try {
    render(<FinancialDataReviewBoundary><CustomerBalance /></FinancialDataReviewBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('LAB-1')
    expect(screen.getByRole('alert').textContent).toContain('لا تُنشئ تسوية تقديرية')
    expect(screen.queryByText('الرصيد 1200')).toBeNull()
    damaged = false
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    expect(screen.getByText('الرصيد 1200')).toBeTruthy()
  } finally { consoleError.mockRestore() }
})

it('تغيير عنوان العرض السليم لا يمحو حالة المستخدم بينما تتغير الفلاتر', () => {
  function Draft() { return <input aria-label="مسودة" defaultValue="" /> }
  const result = render(<FinancialDataReviewBoundary resetKey="/customers"><Draft /></FinancialDataReviewBoundary>)
  const input = screen.getByLabelText('مسودة') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'بيانات لم تحفظ' } })
  result.rerender(<FinancialDataReviewBoundary resetKey="/customers?filter=active"><Draft /></FinancialDataReviewBoundary>)
  expect((screen.getByLabelText('مسودة') as HTMLInputElement).value).toBe('بيانات لم تحفظ')
})

it('الانتقال لعرض آخر بعد خطأ المراجعة يفتح العرض الآخر', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  function Damaged() { throw new FinancialDataReviewError('طلب LAB-2'); return null }
  try {
    const result = render(<FinancialDataReviewBoundary resetKey="/bad"><Damaged /></FinancialDataReviewBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('LAB-2')
    result.rerender(<FinancialDataReviewBoundary resetKey="/other"><span>عرض آخر</span></FinancialDataReviewBoundary>)
    expect(screen.getByText('عرض آخر')).toBeTruthy()
  } finally { consoleError.mockRestore() }
})
