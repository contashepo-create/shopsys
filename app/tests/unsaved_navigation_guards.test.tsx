import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { guardNavigation, useUnsavedChangesGuard } from '../src/ui/components/ui.tsx'
import { hasUnsavedChangesInCurrentWindow } from '../src/ui/components/unsavedChangeRegistry.ts'

afterEach(() => cleanup())

function DirtyEditor({ name }: { name: string }) {
  const guard = useUnsavedChangesGuard(`${name}:changed`, `${name}:saved`)
  return <>{guard.prompt}<span>{name}</span></>
}

/** محرر يُنهي مستنده: يُستخدم للتحقق من release() بعد ترحيل ناجح */
function PostingEditor({ onReady }: { onReady: (release: () => void) => void }) {
  const guard = useUnsavedChangesGuard('posted:changed', 'posted:saved')
  onReady(guard.release)
  return <>{guard.prompt}<span>مستند</span></>
}

describe('حراس التنقل للمحررات غير المحفوظة', () => {
  it('يعرض تأكيد كل محرر متّسخ بالتتابع قبل متابعة التنقل', () => {
    const navigate = vi.fn()
    render(<><DirtyEditor name="company" /><DirtyEditor name="general" /></>)

    act(() => { expect(guardNavigation(navigate)).toBe(true) })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('تراجع عن العملية'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('تراجع عن العملية'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('إلغاء أحد التأكيدات يوقف التنقل ولا يفتح تأكيدات المحررات التالية', () => {
    const navigate = vi.fn()
    render(<><DirtyEditor name="company" /><DirtyEditor name="general" /></>)

    act(() => { guardNavigation(navigate) })
    fireEvent.click(screen.getByText('متابعة التعديل'))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('release() بعد نجاح الحفظ (بلاغ «الفاتورة تُرحَّل ولا تُغلق»)', () => {
  it('يُسقط الحارس تزامنياً في نفس الدالة قبل طلب الإغلاق', () => {
    let release: () => void = () => undefined
    render(<PostingEditor onReady={(fn) => { release = fn }} />)
    expect(hasUnsavedChangesInCurrentWindow()).toBe(true)
    const before = vi.fn()
    expect(guardNavigation(before)).toBe(true) // الحارس ما زال مسجّلاً قبل الحفظ
    expect(before).not.toHaveBeenCalled()

    act(() => { release() })
    expect(hasUnsavedChangesInCurrentWindow()).toBe(false)
    const after = vi.fn()
    /* بلا انتظار setState/effect: الإغلاق يُطلب فوراً بعد release().
       guardNavigation يُعيد false ولا ينفّذ المتابعة — المتصل هو من ينفّذها. */
    if (!guardNavigation(after)) after()
    expect(after).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('لا يُعيد تسجيل الحارس عند تغيّر التوقيع بعد الإنهاء', () => {
    let release: () => void = () => undefined
    const { rerender } = render(<PostingEditor onReady={(fn) => { release = fn }} />)
    act(() => { release() })
    rerender(<PostingEditor onReady={(fn) => { release = fn }} />)
    const after = vi.fn()
    if (!guardNavigation(after)) after()
    expect(after).toHaveBeenCalledOnce()
  })

  it('لا يُلغي حماية محرر آخر مفتوح في النافذة نفسها', () => {
    let release: () => void = () => undefined
    render(<><PostingEditor onReady={(fn) => { release = fn }} /><DirtyEditor name="other" /></>)
    act(() => { release() })
    expect(hasUnsavedChangesInCurrentWindow()).toBe(true)
    const after = vi.fn()
    expect(guardNavigation(after)).toBe(true)
    expect(after).not.toHaveBeenCalled()
  })
})
