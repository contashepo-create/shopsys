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

  it('ينقل الأسهم رأسياً بين خلايا العمود نفسه في صفوف الإدخال', () => {
    const view = render(<MemoryRouter><main><KeyboardNavigation/><div><div data-entry-row><input aria-label="r1c1"/><input aria-label="r1c2"/></div><div data-entry-row><input aria-label="r2c1"/><input aria-label="r2c2"/></div></div></main></MemoryRouter>)
    const first = view.getByLabelText('r1c2'), below = view.getByLabelText('r2c2')
    first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' }); expect(document.activeElement).toBe(below)
    fireEvent.keyDown(below, { key: 'ArrowUp' }); expect(document.activeElement).toBe(first)
  })

  it('ينقل الأسهم بين خلايا كود الصنف القابلة للتركيز', () => {
    const view = render(<MemoryRouter><main><KeyboardNavigation/><div><div data-entry-row><span tabIndex={0} aria-label="code1">A</span></div><div data-entry-row><span tabIndex={0} aria-label="code2">B</span></div></div></main></MemoryRouter>)
    const first = view.getByLabelText('code1'), second = view.getByLabelText('code2')
    first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' }); expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'ArrowUp' }); expect(document.activeElement).toBe(first)
  })

  it('يفتح F3 فاتورة شراء جديدة من قسم المشتريات', () => {
    const view = render(<MemoryRouter initialEntries={['/purchases/invoices']}><KeyboardNavigation/><Routes><Route path="*" element={<Path/>}/></Routes></MemoryRouter>)
    fireEvent.keyDown(document, { key: 'F3' })
    expect(view.getByTestId('path').textContent).toBe('/purchases/invoices/new')
  })
})
