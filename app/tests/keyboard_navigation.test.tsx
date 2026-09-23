import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { KeyboardNavigation } from '../src/ui/components/KeyboardNavigation.tsx'

function Path() { return <span data-testid="path">{useLocation().pathname}</span> }

describe('التحكم بلوحة المفاتيح', () => {
  it('ينقل Enter إلى الحقل التالي وShift+Enter إلى السابق', () => {
    const view = render(<MemoryRouter><main><KeyboardNavigation/><input aria-label="a"/><input aria-label="b"/></main></MemoryRouter>)
    const first = view.getByLabelText('a'), second = view.getByLabelText('b')
    first.focus(); fireEvent.keyDown(first, { key: 'Enter' }); expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'Enter', shiftKey: true }); expect(document.activeElement).toBe(first)
  })

  it('يفتح F3 فاتورة شراء جديدة من قسم المشتريات', () => {
    const view = render(<MemoryRouter initialEntries={['/purchases/invoices']}><KeyboardNavigation/><Routes><Route path="*" element={<Path/>}/></Routes></MemoryRouter>)
    fireEvent.keyDown(document, { key: 'F3' })
    expect(view.getByTestId('path').textContent).toBe('/purchases/invoices/new')
  })
})
