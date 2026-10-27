import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { guardNavigation, useUnsavedChangesGuard } from '../src/ui/components/ui.tsx'

afterEach(() => cleanup())

function DirtyEditor({ name }: { name: string }) {
  const guard = useUnsavedChangesGuard(`${name}:changed`, `${name}:saved`)
  return <>{guard.prompt}<span>{name}</span></>
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
