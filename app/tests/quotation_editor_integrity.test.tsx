import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore, type AdvancedInvoiceDraft } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { quotationPipeline, type Quotation } from '../src/core/contracting.ts'
import { summarizeDraft } from '../src/ui/components/draftSummary.ts'
import { formatMinor } from '../src/core/money.ts'
import { getCountry } from '../src/core/countries.ts'
import { QuotationsPage } from '../src/ui/pages/QuotationsPage.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'

const originalData = useRawDataStore.getState(), originalApp = useAppStore.getState()
const quote: Quotation = {
  id: 7, quoteNumber: 'QT-0007', kind: 'quotation', clientName: 'عميل', clientId: 12,
  titleAr: 'عرض أصلي', date: '2026-11-01', validUntil: '2099-01-01', status: 'draft',
  lines: [{ nameAr: 'خدمة', descriptionAr: 'بند أصلي', qty: 1, unitAr: 'عدد', unitPriceMinor: 10000, estCostMinor: 0, vatPercent: 0 }],
  notes: '', projectId: null, winProbability: 50, bidBondMinor: 0,
}
const draft = (id: string, titleAr: string, editingQuoteId?: number): AdvancedInvoiceDraft => ({
  id, kind: 'quotation', name: titleAr, createdAt: '2026-11-01T00:00:00', updatedAt: '2026-11-01T00:00:00',
  payload: JSON.stringify({ kind: 'quotation', titleAr, clientName: 'عميل', clientId: '12', validUntil: '2099-01-01', qLines: [{ key: `${id}-line`, nameAr: 'خدمة', descriptionAr: 'بند مسودة', qty: '1', unitAr: 'عدد', unitPrice: '100', estCost: '0', vat: '0', incl: false }], notes: '', winProb: '50', bidBond: '', ...(editingQuoteId != null ? { editingQuoteId } : {}) }),
})
const mount = () => render(<MemoryRouter><QuotationsPage /><ToastHost /></MemoryRouter>)
const pick = (id: string) => {
  fireEvent.click(screen.getByTitle('فتح أي مسودة محفوظة باسم العميل'))
  const row = document.querySelector(`[data-draft-row="${id}"]`) as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: /فتح/ }))
}
const post = () => fireEvent.click(screen.getByRole('button', { name: /حفظ وترحيل/ }))

beforeEach(() => {
  const setup = { ...originalApp.setup, activityId: 'contracting', countryCode: 'SA', modules: ['contracting', 'inventory', 'purchases'] as typeof originalApp.setup.modules, taxRegistrationStatus: 'registered' as const, vatPercent: 15 }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...originalData, branches: [], activeBranchId: null, currentUserId: null, quotations: [quote], customers: [{ ...EMPTY_EXTENDED, id: 12, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' }], advancedInvoiceDrafts: [] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); useRawDataStore.setState(originalData); useAppStore.setState(originalApp) })

describe('سلامة محرر ومسودات عروض الأسعار', () => {
  it('استعادة مسودة قديمة غير مرتبطة أثناء تعديل عرض لا تستبدل العرض الأصلي', () => {
    useRawDataStore.setState({ advancedInvoiceDrafts: [draft('picked', 'عرض مسودة'), draft('other', 'مسودة أخرى')] })
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    pick('picked')
    expect(screen.getByText(/مسودة قديمة بلا مرجع للعرض الأصلي/)).toBeTruthy()
    post()
    const state = useRawDataStore.getState()
    expect(state.quotations.find(q => q.id === 7)).toEqual(quote)
    expect(state.quotations.find(q => q.id !== 7)?.titleAr).toBe('عرض مسودة')
    expect(state.advancedInvoiceDrafts.map(d => d.id)).toEqual(['other'])
  })

  it('مسودة تعديل عرض محفوظ تستعيد العرض الصحيح وتُحذف بعد اعتماد تعديله', () => {
    useRawDataStore.setState({ advancedInvoiceDrafts: [draft('edit-draft', 'تعديل مستعاد', 7)] })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /عرض \/ مناقصة/ }))
    pick('edit-draft')
    post()
    const state = useRawDataStore.getState()
    expect(state.quotations).toHaveLength(1)
    expect(state.quotations[0].titleAr).toBe('تعديل مستعاد')
    expect(state.advancedInvoiceDrafts).toHaveLength(0)
  })

  it('يحفظ مرجع عرض التعديل في المسودة، ويفصل مسودات المستندات الجديدة', () => {
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const saved = useRawDataStore.getState().advancedInvoiceDrafts[0]
    expect(JSON.parse(saved.payload).editingQuoteId).toBe(7)
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق المستند' }))
    fireEvent.click(screen.getByRole('button', { name: /عرض \/ مناقصة/ }))
    fireEvent.change(screen.getByPlaceholderText('تشطيب فيلا — الدور الأول…'), { target: { value: 'عرض مستقل' } })
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const drafts = useRawDataStore.getState().advancedInvoiceDrafts
    expect(drafts).toHaveLength(2)
    expect(drafts[0].id).toBe(saved.id)
    expect(JSON.parse(drafts[1].payload).editingQuoteId).toBeNull()
    expect(JSON.parse(drafts[1].payload).qLines[0].vat).toBe('15')
  })

  it('رفض مسودة مرتبطة بعرض غير متاح لا يغيّر العرض المفتوح', () => {
    useRawDataStore.setState({ advancedInvoiceDrafts: [draft('bad-ref', 'غير متاحة', 99)] })
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    pick('bad-ref')
    expect((screen.getByPlaceholderText('تشطيب فيلا — الدور الأول…') as HTMLInputElement).value).toBe('عرض أصلي')
    expect(useRawDataStore.getState().quotations).toEqual([quote])
    expect(useRawDataStore.getState().advancedInvoiceDrafts).toHaveLength(1)
  })

  it('يرفض مسودة بسطر تالف دون استبدال العرض المفتوح', () => {
    const d = draft('corrupt', 'مسودة تالفة')
    const payload = JSON.parse(d.payload)
    payload.qLines[0].incl = 'false'
    useRawDataStore.setState({ advancedInvoiceDrafts: [{ ...d, payload: JSON.stringify(payload) }] })
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    pick('corrupt')
    expect(screen.getByText(/تعذر قراءة المسودة المحفوظة/)).toBeTruthy()
    expect((screen.getByPlaceholderText('تشطيب فيلا — الدور الأول…') as HTMLInputElement).value).toBe('عرض أصلي')
    expect(useRawDataStore.getState().quotations).toEqual([quote])
  })

  it('يرفض استعادة مسودة لعرض تحوّل إلى مشروع دون تغيير العرض المفتوح', () => {
    const d = draft('picked', 'مسودة المحول')
    const payload = { ...JSON.parse(d.payload), editingQuoteId: 99 }
    useRawDataStore.setState({ quotations: [quote, { ...quote, id: 99, quoteNumber: 'QT-99', projectId: 55, status: 'won' }], advancedInvoiceDrafts: [{ ...d, payload: JSON.stringify(payload) }] })
    render(<MemoryRouter><QuotationsPage /><ToastHost /></MemoryRouter>)
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    pick('picked')
    expect(screen.getByText(/العرض المرتبط بالمسودة غير متاح/)).toBeTruthy()
    expect((screen.getByPlaceholderText('تشطيب فيلا — الدور الأول…') as HTMLInputElement).value).toBe('عرض أصلي')
  })

  it('فشل حذف المسودة بعد الحفظ لا يظهر كفشل اعتماد ولا ينشئ عرضاً ثانياً', () => {
    useRawDataStore.setState({ deleteAdvancedInvoiceDraft: () => { throw new Error('storage unavailable') } })
    render(<MemoryRouter><QuotationsPage /><ToastHost /></MemoryRouter>)
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    post()
    expect(useRawDataStore.getState().quotations).toHaveLength(1)
    expect(screen.getByText(/حُفظ العرض، لكن تعذّر حذف مسودته/)).toBeTruthy()
    expect(screen.getByTitle('فتح العرض وتعديله')).toBeTruthy()
  })

  it('حفظ المسودة المستعادة يعدّل معرفها ولا ينشئ مسودة جديدة', () => {
    useRawDataStore.setState({ advancedInvoiceDrafts: [draft('picked', 'عرض مسودة')] })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /عرض \/ مناقصة/ }))
    pick('picked')
    fireEvent.change(screen.getByPlaceholderText('تشطيب فيلا — الدور الأول…'), { target: { value: 'تعديل مسودة' } })
    fireEvent.click(screen.getByRole('button', { name: /حفظ مسودة/ }))
    const rows = useRawDataStore.getState().advancedInvoiceDrafts
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('picked')
    expect(JSON.parse(rows[0].payload).titleAr).toBe('تعديل مسودة')
  })

  it('يحتفظ بنسبة الصفر عند فتح عرض محفوظ وتعديله لمنشأة مسجلة بنسبة 15٪', () => {
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    post()
    expect(useRawDataStore.getState().quotations[0].lines[0].vatPercent).toBe(0)
  })

  it('يمكن مراجعة ضريبة البند وتغييرها وجعل السعر شاملاً قبل الاعتماد', () => {
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    fireEvent.change(screen.getByLabelText('ضريبة البند 1'), { target: { value: '15' } })
    fireEvent.click(screen.getByLabelText('سعر البند 1 شامل الضريبة'))
    post()
    expect(useRawDataStore.getState().quotations[0].lines[0]).toMatchObject({ vatPercent: 15, taxIncluded: true, unitPriceMinor: 10000 })
  })

  it('لا يعتمد نسبة ضريبة خارج النطاق أو فارغة بدلاً من تغييرها بصمت', () => {
    mount()
    fireEvent.click(screen.getByTitle('فتح العرض وتعديله'))
    const input = screen.getByLabelText('ضريبة البند 1')
    for (const vat of ['150', '']) {
      fireEvent.change(input, { target: { value: vat } })
      post()
      expect(useRawDataStore.getState().quotations[0]).toEqual(quote)
    }
  })

  it('القيمة في القائمة تطابق إجمالي معاينة العرض شاملاً الضريبة المضافة', () => {
    useRawDataStore.setState({ quotations: [{ ...quote, lines: [{ ...quote.lines[0], vatPercent: 15 }] }] })
    const view = mount()
    const row = view.container.querySelector('tbody tr') as HTMLTableRowElement
    const currency = getCountry('SA')!.currency
    expect(row.cells[2].textContent).toBe(formatMinor(11500, currency, false))
  })

  it('إحصاءات العروض المقدمة تُظهر القيمة الشاملة نفسها في الحالتين الشاملة والمضافة', () => {
    const added = { ...quote, status: 'submitted' as const, lines: [{ ...quote.lines[0], vatPercent: 15 }] }
    const included = { ...added, id: 8, lines: [{ ...quote.lines[0], unitPriceMinor: 11500, vatPercent: 15, taxIncluded: true }] }
    expect(quotationPipeline([added, included])).toEqual({ submittedCount: 2, submittedMinor: 23000, expectedMinor: 11500 })
  })

  it('ملخص المسودة يحسب بنود العروض والضريبة وخانات العملة الصحيحة', () => {
    const d = draft('picked', 'مسودة اختبار')
    const payload = JSON.parse(d.payload)
    payload.qLines[0].vat = '15'
    expect(summarizeDraft({ ...d, payload: JSON.stringify(payload) }, 2)).toMatchObject({ lineCount: 1, totalMinor: 11500 })
    payload.qLines[0].unitPrice = '1.234'
    expect(summarizeDraft({ ...d, payload: JSON.stringify(payload) }, 3)).toMatchObject({ lineCount: 1, totalMinor: 1419 })
  })

  it('يفتح الشاشة والمحرر إذا غابت randomUUID مع توفر getRandomValues', () => {
    const old = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      mount()
      fireEvent.click(screen.getByRole('button', { name: /عرض \/ مناقصة/ }))
      expect(document.querySelector('[data-quotation-doc-editor]')).toBeTruthy()
    } finally {
      if (old) Object.defineProperty(globalThis.crypto, 'randomUUID', old)
      else delete (globalThis.crypto as Partial<Crypto>).randomUUID
    }
  })
})
