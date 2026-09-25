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
      expect(view.getAllByText('سكر أبيض').length).toBeGreaterThan(0)
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onPick).toHaveBeenLastCalledWith(1)
    }
  })

  it('لا يخفي الأصناف أو الموردين بعد أول 30 نتيجة', () => {
    const manyItems = Array.from({ length: 35 }, (_, index) => ({ id: index + 1, nameAr: `صنف ${index + 1}`, sku: `SKU-${index + 1}`, barcodes: [] }))
    const itemView = render(<ItemQuickPicker items={manyItems} onPick={() => undefined}/>)
    fireEvent.change(itemView.getByPlaceholderText(/اكتب كود أو اسم/), { target: { value: 'صنف' } })
    expect(itemView.getByText('صنف 35')).toBeTruthy()
    cleanup()

    const manyParties = Array.from({ length: 35 }, (_, index) => ({ id: index + 1, nameAr: `مورد ${index + 1}` }))
    const partyView = render(<PartyQuickPicker parties={manyParties} value={0} onChange={() => undefined} cashLabel="مورد نقدي" label="المورد"/>)
    fireEvent.change(partyView.getByLabelText('المورد'), { target: { value: 'مورد' } })
    expect(partyView.getByText('مورد 35')).toBeTruthy()
  })

  it('يحدد أول نتيجة افتراضياً ويتنقل بالأسهم ثم يغلق بـ Escape', () => {
    const onPick = vi.fn()
    const view = render(<ItemQuickPicker items={items} onPick={onPick}/>)
    const input = view.getByPlaceholderText(/اكتب كود أو اسم/)
    fireEvent.change(input, { target: { value: 'ص' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(2)
    fireEvent.change(input, { target: { value: 'س' } })
    expect(view.getAllByText('سكر أبيض').length).toBeGreaterThan(0)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(view.queryByText('سكر أبيض')).toBeNull()
  })

  it('يفتح منتقي الطرف عبر F4 ويختار العميل بالأسهم وEnter', () => {
    const onChange = vi.fn(), onConfirm = vi.fn()
    const view = render(<MemoryRouter><KeyboardNavigation/><PartyQuickPicker parties={[{ id: 10, nameAr: 'أحمد', phone: '010' }, { id: 11, nameAr: 'منى', phone: '011' }]} value={0} onChange={onChange} cashLabel="عميل نقدي" label="العميل" onConfirm={onConfirm}/></MemoryRouter>)
    const input = view.getByLabelText('العميل')
    fireEvent.keyDown(document, { key: 'F4' })
    expect(document.activeElement).toBe(input)
    expect(view.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(11)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('يفتح منتقي الطرف الموجود في النافذة النشطة فقط عند تعدد المنتقيات', () => {
    const view = render(<MemoryRouter><KeyboardNavigation/><PartyQuickPicker parties={[{ id: 1, nameAr: 'عميل الصفحة' }]} value={0} onChange={() => undefined} cashLabel="عميل نقدي" label="طرف الصفحة"/><div role="dialog"><PartyQuickPicker parties={[{ id: 2, nameAr: 'عميل النافذة' }]} value={0} onChange={() => undefined} cashLabel="عميل نقدي" label="طرف النافذة"/></div></MemoryRouter>)
    fireEvent.keyDown(document, { key: 'F4' })
    expect(view.getAllByRole('dialog')).toHaveLength(2)
    expect(view.getByRole('dialog', { name: 'طرف النافذة — نتائج البحث' })).toBeTruthy()
    expect(view.queryByRole('dialog', { name: 'طرف الصفحة — نتائج البحث' })).toBeNull()
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

  it('يغلق قائمة الصنف عند النقر خارجها', () => {
    const view = render(<ItemQuickPicker items={items} onPick={() => undefined}/>)
    const input = view.getByPlaceholderText(/اكتب كود أو اسم/)
    fireEvent.change(input, { target: { value: 'س' } })
    expect(view.getAllByText('سكر أبيض').length).toBeGreaterThan(0)
    fireEvent.pointerDown(document.body)
    expect(view.queryByText('سكر أبيض')).toBeNull()
  })

  it('يؤكد مورد نقدي بالـ Enter وينقل التركيز إلى بحث الصنف', async () => {
    const onChange = vi.fn()
    const view = render(<><PartyQuickPicker parties={[{ id: 10, nameAr: 'أحمد' }]} value={-1} onChange={onChange} cashLabel="مورد نقدي" label="المورد" onConfirm={() => window.dispatchEvent(new Event('shopsys:focus-item'))} autoFocus/><ItemQuickPicker items={items} onPick={() => undefined}/></>)
    await waitFor(() => expect(document.activeElement).toBe(view.getByLabelText('المورد')))
    fireEvent.keyDown(view.getByLabelText('المورد'), { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(view.getByPlaceholderText(/اكتب كود أو اسم/)))
    expect(onChange).toHaveBeenCalledWith(-1)
  })

  it('يفتح بحث الصنف تلقائياً بعد اختيار عميل نقدي', async () => {
    const view = render(<><PartyQuickPicker parties={[{ id: 10, nameAr: 'أحمد' }]} value={0} onChange={() => undefined} cashLabel="عميل نقدي" label="العميل" onConfirm={() => window.dispatchEvent(new Event('shopsys:focus-item'))} autoFocus/><ItemQuickPicker items={items} onPick={() => undefined}/></>)
    await waitFor(() => expect(document.activeElement).toBe(view.getByLabelText('العميل')))
    const party = view.getByLabelText('العميل')
    fireEvent.focus(party)
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.change(party, { target: { value: 'أ' } })
    expect(view.getByRole('dialog')).toBeTruthy()
  })

  it('يعرض كود الطرف ورصيده وحالته ويبحث بالكود من أول حرف', () => {
    const view = render(<PartyQuickPicker parties={[{ id: 1, nameAr: 'عميل متوقف', active: false }, { id: 2, nameAr: 'عميل نشط', active: true }]} value={0} onChange={() => undefined} cashLabel="عميل نقدي" label="العميل" partyInfo={(party) => ({ code: `CUS-000${party.id}`, balance: `${party.id} ج.م`, status: party.active === false ? 'موقوف' : undefined })} />)
    const input = view.getByLabelText('العميل')
    fireEvent.focus(input)
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.change(input, { target: { value: 'CUS-0001' } })
    expect(view.getByText('CUS-0001')).toBeTruthy()
    expect(view.getByText('1 ج.م')).toBeTruthy()
    expect(view.getByText('موقوف')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'CUS-0002' } })
    expect(view.getByText('عميل نشط')).toBeTruthy()
    expect(view.queryByText('موقوف')).toBeNull()
  })

  it('يفتح منتقي الصنف عبر F5 ويبدل دليل الاختصارات عبر F12', () => {
    const view = render(<MemoryRouter><KeyboardNavigation/><ItemQuickPicker items={items} onPick={() => undefined}/></MemoryRouter>)
    const input = view.getByPlaceholderText(/اكتب كود أو اسم/)
    fireEvent.keyDown(document, { key: 'F5' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(document, { key: 'F12' })
    expect(view.getAllByRole('dialog').some((dialog) => dialog.textContent?.includes('F4'))).toBe(true)
    expect(view.getAllByRole('dialog').some((dialog) => dialog.textContent?.includes('بحث صنف'))).toBe(true)
    fireEvent.keyDown(document, { key: 'F12' })
    expect(view.getAllByRole('dialog').some((dialog) => dialog.textContent?.includes('اختصارات'))).toBe(false)
  })
})
