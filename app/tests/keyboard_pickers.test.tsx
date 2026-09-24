import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemQuickPicker, PartyQuickPicker } from '../src/ui/components/KeyboardPickers.tsx'
import { KeyboardNavigation } from '../src/ui/components/KeyboardNavigation.tsx'

afterEach(cleanup)

const items = [
  { id: 1, nameAr: 'سكر أبيض', sku: 'SUG-1', barcodes: ['622100'] },
  { id: 2, nameAr: 'أرز مصري', sku: 'RIC-2', barcodes: ['622200'] },
]

describe('منتقيات لوحة المفاتيح الموحدة', () => {
  it('يبحث عن الصنف بالاسم والكود والباركود والرقم ويختار أول نتيجة بـ Enter', () => {
    const onPick = vi.fn()
    const view = render(<ItemQuickPicker items={items} onPick={onPick}/>)
    const input = view.getByPlaceholderText(/اكتب كود أو اسم/)
    for (const query of ['سكر', 'SUG-1', '622100', '1']) {
      fireEvent.change(input, { target: { value: query } })
      expect(view.getByText('سكر أبيض')).toBeTruthy()
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onPick).toHaveBeenLastCalledWith(1)
    }
  })

  it('يحدد أول نتيجة افتراضياً ويتنقل بالأسهم ثم يغلق بـ Escape', () => {
    const onPick = vi.fn()
    const view = render(<ItemQuickPicker items={items} onPick={onPick}/>)
    const input = view.getByPlaceholderText(/اكتب كود أو اسم/)
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(2)
    fireEvent.focus(input)
    expect(view.getByText('سكر أبيض')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(view.queryByText('سكر أبيض')).toBeNull()
  })

  it('يفتح منتقي الطرف عبر F4 ويختار العميل بالأسهم وEnter', () => {
    const onChange = vi.fn(), onConfirm = vi.fn()
    const view = render(<MemoryRouter><KeyboardNavigation/><PartyQuickPicker parties={[{ id: 10, nameAr: 'أحمد', phone: '010' }, { id: 11, nameAr: 'منى', phone: '011' }]} value={0} onChange={onChange} cashLabel="عميل نقدي" label="العميل" onConfirm={onConfirm}/></MemoryRouter>)
    const input = view.getByLabelText('العميل')
    fireEvent.keyDown(document, { key: 'F4' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(11)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('يركز العميل تلقائياً وينقل Enter بعد الاختيار إلى بحث الصنف', async () => {
    const onChange = vi.fn()
    const view = render(<><PartyQuickPicker parties={[{ id: 10, nameAr: 'أحمد' }]} value={0} onChange={onChange} cashLabel="عميل نقدي" label="العميل" onConfirm={() => window.dispatchEvent(new Event('shopsys:focus-item'))} autoFocus/><ItemQuickPicker items={items} onPick={() => undefined}/></>)
    const party = view.getByLabelText('العميل')
    await waitFor(() => expect(document.activeElement).toBe(party))
    fireEvent.change(party, { target: { value: 'أحمد' } })
    fireEvent.keyDown(party, { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(view.getByPlaceholderText(/اكتب كود أو اسم/)))
    expect(onChange).toHaveBeenCalledWith(10)
  })

  it('يفتح منتقي الصنف عبر F5 ويبدل دليل الاختصارات عبر F12', () => {
    const view = render(<MemoryRouter><KeyboardNavigation/><ItemQuickPicker items={items} onPick={() => undefined}/></MemoryRouter>)
    const input = view.getByPlaceholderText(/اكتب كود أو اسم/)
    fireEvent.keyDown(document, { key: 'F5' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(document, { key: 'F12' })
    expect(view.getByRole('dialog').textContent).toContain('F4')
    expect(view.getByRole('dialog').textContent).toContain('بحث صنف')
    fireEvent.keyDown(document, { key: 'F12' })
    expect(view.queryByRole('dialog')).toBeNull()
  })
})
