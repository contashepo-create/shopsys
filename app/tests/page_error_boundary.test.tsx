import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PageErrorBoundary } from '../src/ui/AppErrorBoundary.tsx'
import { FinancialDataReviewBoundary } from '../src/ui/components/FinancialDataReviewBoundary.tsx'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'

/**
 * حدّ الخطأ على مستوى الصفحة.
 *
 * العيب قبل الإصلاح: الحدّ الوحيد كان على مستوى التطبيق كله، وحدّ المراجعة المالية
 * يُعيد رفع أي خطأ آخر — فخطأ في شاشة واحدة (صف بلا مفتاح، بيانات قديمة) كان يمحو
 * الشريط الجانبي ويعيد المالك إلى شاشة خطأ كاملة، فيفقد ما لا علاقة له بالخطأ.
 */

function Boom(): never {
  throw new Error('shateh: زر معطوب')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PageErrorBoundary — الشاشة تسقط والغلاف يبقى', () => {
  it('يعرض بطاقة داخل الصفحة مع رقم حادث وزر إعادة محاولة', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<PageErrorBoundary><Boom /></PageErrorBoundary>)
    const card = document.querySelector('[data-page-error-boundary]')
    expect(card).toBeTruthy()
    expect(card!.textContent).toContain('تعذّر عرض هذه الشاشة')
    expect(card!.textContent).toContain('ERR-')
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy()
  })

  it('إعادة المحاولة تعيد رسم الشجرة بلا إعادة تشغيل التطبيق', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let broken = true
    function Flaky() {
      if (broken) throw new Error('حالة مؤقتة')
      return <div>عادت الشاشة</div>
    }
    render(<PageErrorBoundary><Flaky /></PageErrorBoundary>)
    expect(document.querySelector('[data-page-error-boundary]')).toBeTruthy()
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    expect(screen.getByText('عادت الشاشة')).toBeTruthy()
    expect(document.querySelector('[data-page-error-boundary]')).toBeNull()
  })

  it('خطأ المراجعة المالية يُبقى برسالته المهنية لا برسالة «شاشة معطوبة»', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function FinancialBoom(): never {
      throw new FinancialDataReviewError('الوردية', 'القيد لا يطابق الوردية')
    }
    render(<PageErrorBoundary><FinancialDataReviewBoundary><FinancialBoom /></FinancialDataReviewBoundary></PageErrorBoundary>)
    expect(screen.getByText(/البيانات المالية تحتاج مراجعة/)).toBeTruthy()
    expect(document.querySelector('[data-page-error-boundary]')).toBeNull()
  })
})
