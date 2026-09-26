import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AppErrorBoundary } from '../src/ui/AppErrorBoundary.tsx'
import { getLogLines, LOG_KEY } from '../src/core/applog.ts'

function Broken({ fail = true }: { fail?: boolean }) {
  if (fail) throw new Error('اختبار تعطل آمن')
  return <p>عادت الشاشة</p>
}

describe('حاجز أعطال التطبيق', () => {
  beforeEach(() => {
    localStorage.removeItem(LOG_KEY)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('يعرض رسالة عربية آمنة ومعرف تتبع ويسجل العطل محلياً', () => {
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>)

    expect(screen.getByRole('alert').textContent).toContain('حدث خطأ غير متوقع')
    expect(screen.getByText(/^ERR-/)).toBeTruthy()
    expect(screen.queryByText(/componentStack|at Broken/)).toBeNull()
    expect(getLogLines().at(-1)?.msg).toContain('React boundary ERR-')
  })

  it('يسمح بمحاولة إعادة فتح الشجرة دون تحديث الصفحة', () => {
    let fail = true
    function Recoverable() {
      if (fail) throw new Error('مرة واحدة')
      return <p>عادت الشاشة</p>
    }

    render(<AppErrorBoundary><Recoverable /></AppErrorBoundary>)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /إعادة فتح الشاشة/ }))
    expect(screen.getByText('عادت الشاشة')).toBeTruthy()
  })
})
