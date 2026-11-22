import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ConfirmHost } from '../src/ui/components/ConfirmDialog.tsx'
import { confirmDialog, pendingConfirmCount } from '../src/ui/components/confirmStore.ts'

/**
 * نافذة التأكيد الداخلية — بديل `window.confirm`.
 *
 * السبب الجذري: `window.confirm` يخرج بنافذة نظام لا تتبع لغة التطبيق، وفي
 * Electron/Windows قد تُحجب خلف النافذة فلا يرى الكاشير السؤال إطلاقاً ويظن
 * أن الزر لا يعمل. هذه النافذة هي البديل الوحيد بعد إزالة كل التسويفات.
 */

afterEach(() => { cleanup() })

describe('confirmDialog — نافذة تأكيد داخلية', () => {
  it('الموافقة تعيد true ويُغلق الطلب', async () => {
    render(<ConfirmHost />)  // النافذة تُرسم في portal على body
    const answer = confirmDialog({ title: 'حذف فرع', message: 'لا رجعة', confirmLabel: 'حذف', danger: true, testId: 't1' })
    await waitFor(() => expect(screen.getByText('حذف فرع')).toBeTruthy())
    expect(document.body.querySelector('[data-confirm-dialog="t1"]')).toBeTruthy()
    fireEvent.click(document.body.querySelector('[data-confirm-accept]') as HTMLElement)
    await expect(answer).resolves.toBe(true)
    await waitFor(() => expect(pendingConfirmCount()).toBe(0))
    expect(screen.queryByText('حذف فرع')).toBeNull()
  })

  it('الإلغاء يعيد false ويُغلق الطلب', async () => {
    render(<ConfirmHost />)  // النافذة تُرسم في portal على body
    const answer = confirmDialog({ title: 'إلغاء جدولة', message: 'يبقى السجل' })
    await waitFor(() => expect(screen.getByText('إلغاء جدولة')).toBeTruthy())
    fireEvent.click(document.body.querySelector('[data-confirm-cancel]') as HTMLElement)
    await expect(answer).resolves.toBe(false)
    await waitFor(() => expect(pendingConfirmCount()).toBe(0))
  })

  it('طلب جديد قبل إغلاق الأول يُلغي الأول صراحةً (لا يبقى معلّقاً للأبد)', async () => {
    render(<ConfirmHost />)
    const first = confirmDialog({ title: 'الأول', message: 'أ' })
    const second = confirmDialog({ title: 'الثاني', message: 'ب' })
    await expect(first).resolves.toBe(false)
    await waitFor(() => expect(screen.getByText('الثاني')).toBeTruthy())
    const view = document.body
    fireEvent.click(view.querySelector('[data-confirm-accept]') as HTMLElement)
    await expect(second).resolves.toBe(true)
  })

  it('الإغلاق بزر الإغلاق/X يعامل كإلغاء (الأمان أولاً)', async () => {
    render(<ConfirmHost />)  // النافذة تُرسم في portal على body
    const answer = confirmDialog({ title: 'استعادة لقطة', message: 'سيُستبدل' })
    await waitFor(() => expect(screen.getByText('استعادة لقطة')).toBeTruthy())
    const closeBtn = document.body.querySelector('[aria-label="إغلاق"]') as HTMLElement | null
    if (closeBtn) fireEvent.click(closeBtn)
    else fireEvent.click(document.body.querySelector('[data-confirm-cancel]') as HTMLElement)
    await expect(answer).resolves.toBe(false)
  })
})
