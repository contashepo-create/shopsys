import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { buildPartyNote, normalizePartyNoteText, partyNotesFor, formatPartyNoteLine } = await import('../src/core/partyNotes.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { PartyNotesLog } = await import('../src/ui/components/PartyNotesLog.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()

beforeEach(() => {
  useDataStore.setState({ partyNotes: [] })
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery', shopName: 'متجر', ownerName: 'المالك' } })
})
afterEach(() => cleanup())

describe('سجل ملاحظات الأطراف', () => {
  it('ينظّف النص ويرفض الملاحظة الفارغة أو الطرف غير المسجَّل', () => {
    expect(normalizePartyNoteText('  ملاحظة   بمسافات \n كثيرة ')).toBe('ملاحظة بمسافات كثيرة')
    expect(() => buildPartyNote({ partyKind: 'customer', partyId: 3, text: '   ', userName: 'المالك' })).toThrow('لا يمكن حفظ ملاحظة فارغة')
    // البيع النقدي بلا سجل عميل — لا مكان تُحفظ فيه الملاحظة
    expect(() => buildPartyNote({ partyKind: 'customer', partyId: 0, text: 'تسليم صباحاً', userName: 'المالك' })).toThrow('اختر طرفاً مسجَّلاً')
  })

  it('يقيّد ملاحظة الفاتورة في سجل العميل بتاريخها وكاتبها ورقم الفاتورة', () => {
    const note = S().addPartyNote({ partyKind: 'customer', partyId: 7, text: 'يطلب التسليم صباحاً', userName: 'محمد عبده', source: 'INV-12' })
    expect(S().partyNotes).toHaveLength(1)
    expect(note.source).toBe('INV-12')
    expect(note.userName).toBe('محمد عبده')
    expect(Number.isNaN(Date.parse(note.at))).toBe(false)
    expect(formatPartyNoteLine(note)).toContain('محمد عبده · INV-12 — يطلب التسليم صباحاً')
  })

  it('يفصل ملاحظات كل طرف عن الآخر ويعرض الأحدث أولاً', () => {
    S().addPartyNote({ partyKind: 'customer', partyId: 7, text: 'الأقدم', userName: 'المالك', source: 'INV-1' })
    S().addPartyNote({ partyKind: 'supplier', partyId: 7, text: 'ملاحظة مورد', userName: 'المالك' })
    S().addPartyNote({ partyKind: 'customer', partyId: 9, text: 'عميل آخر', userName: 'المالك' })
    S().addPartyNote({ partyKind: 'customer', partyId: 7, text: 'الأحدث', userName: 'المالك', source: 'INV-2' })
    const notes = partyNotesFor(S().partyNotes, 'customer', 7)
    expect(notes.map((note) => note.text)).toEqual(['الأحدث', 'الأقدم'])
    expect(partyNotesFor(S().partyNotes, 'supplier', 7).map((note) => note.text)).toEqual(['ملاحظة مورد'])
  })

  it('سجل الملاحظات في بروفايل العميل يعرض التاريخ ويضيف ويحذف', () => {
    S().addPartyNote({ partyKind: 'customer', partyId: 5, text: 'سدد شيك أكتوبر', userName: 'المالك', source: 'INV-30' })
    const view = render(<><ToastHost /><PartyNotesLog kind="customer" partyId={5} partyName="مصنع النور" /></>)
    expect(view.getByText('سدد شيك أكتوبر')).toBeTruthy()
    expect(view.getByText(/INV-30/)).toBeTruthy()

    const input = view.getByLabelText('ملاحظة جديدة عن العميل') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'وعد بالسداد الأسبوع القادم' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(partyNotesFor(S().partyNotes, 'customer', 5).map((note) => note.text)).toEqual(['وعد بالسداد الأسبوع القادم', 'سدد شيك أكتوبر'])
    expect(input.value).toBe('')

    fireEvent.click(view.getAllByLabelText('حذف الملاحظة من السجل')[0])
    expect(partyNotesFor(S().partyNotes, 'customer', 5)).toHaveLength(1)
  })

  it('لا ملاحظة مكرَّرة الحفظ: السجل يحفظ نصاً منظَّفاً ومحدود الطول', () => {
    const long = 'ن'.repeat(600)
    const note = S().addPartyNote({ partyKind: 'supplier', partyId: 2, text: long, userName: 'المالك' })
    expect(note.text.length).toBe(400)
  })
})
