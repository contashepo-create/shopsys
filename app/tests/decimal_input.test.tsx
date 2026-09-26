import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DecimalInput } from '../src/ui/components/ui.tsx'

afterEach(cleanup)

describe('حقول الأرقام العشرية', () => {
  it('لا يفقد النقطة أثناء الكتابة في الحقل المتحكم به', () => {
    const onValueChange = vi.fn()
    const view = render(<DecimalInput value="" onValueChange={onValueChange} aria-label="قيمة" />)
    const input = view.getByLabelText('قيمة') as HTMLInputElement

    fireEvent.change(input, { target: { value: '1.' } })
    expect(input.value).toBe('1.')
    expect(onValueChange).toHaveBeenLastCalledWith('1.')

    fireEvent.change(input, { target: { value: '1.5' } })
    expect(input.value).toBe('1.5')
    expect(onValueChange).toHaveBeenLastCalledWith('1.5')
  })

  it('يوحّد الفاصلة العربية أو الإنجليزية إلى نقطة', () => {
    const onValueChange = vi.fn()
    const view = render(<DecimalInput value="" onValueChange={onValueChange} aria-label="قيمة" />)
    const input = view.getByLabelText('قيمة') as HTMLInputElement

    fireEvent.change(input, { target: { value: '١٫٥' } })
    expect(input.value).toBe('1.5')
    expect(onValueChange).toHaveBeenLastCalledWith('1.5')
  })
})
